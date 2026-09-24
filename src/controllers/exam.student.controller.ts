import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { Exam } from '../models/exam.model';
import { ExamPurchase } from '../models/exam-purchase.model';
import { ExamSubmission } from '../models/exam-submission.model';
import { ExamAttempt } from '../models/exam-attempt.model';
import { UserSubscription } from '../models/subscription.model';
import { calculateGrade, evaluateAnswer } from '../utils/exam.utils';
import { logger } from '../lib/logger';
import { getSocketIOInstance } from '../app';

// Escape user input for safe use in RegExp
function escapeRegExp(input: string): string {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const purchaseExam = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { id } = req.params;

    if (user.role === 'teacher') {
      logger.warn({ userId: user.id, examId: id }, 'Teacher attempted to purchase exam');
      res.status(403).json({
        success: false,
        code: 'TEACHER_PURCHASE_FORBIDDEN',
        message: 'Teachers cannot purchase exams. Only students can enroll in or purchase exams.',
      });
      return;
    }

    const isValidId = mongoose.isValidObjectId(id);
    const exam = isValidId
      ? await Exam.findById(id)
      : await Exam.findOne({ $or: [{ joinCode: new RegExp(`^${escapeRegExp(id)}$`, 'i') }, { accessToken: id }] });

    if (!exam) {
      logger.warn({ examId: id }, 'Exam not found for purchase');
      res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Exam not found',
      });
      return;
    }

    if (exam.accessType === 'free' && (!exam.price || exam.price <= 0)) {
      res.status(400).json({
        success: false,
        code: 'INVALID_REQUEST',
        message: 'This is a free exam. No purchase required.',
      });
      return;
    }

    const alreadySubmitted = await ExamSubmission.findOne({
      examId: exam._id,
      $or: [{ studentId: user.id }, { studentEmail: user.email }],
    });

    if (alreadySubmitted) {
      res.status(403).json({
        success: false,
        code: 'ALREADY_COMPLETED',
        message: 'You have already attempted and submitted this examination. Retakes and re-purchases are not permitted.',
      });
      return;
    }

    const existing = await ExamPurchase.findOne({
      studentId: user.id,
      examId: exam._id,
      status: 'completed',
    });

    if (existing) {
      res.status(400).json({
        success: false,
        code: 'ALREADY_PURCHASED',
        message: 'You have already purchased this exam.',
      });
      return;
    }

    let purchase: any;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const purchaseResult = await ExamPurchase.create([{
        studentId: user.id,
        studentEmail: user.email,
        studentName: user.name,
        examId: exam._id,
        teacherId: exam.teacherId,
        teacherEmail: exam.teacherEmail,
        pricePaid: exam.price,
        paymentId: req.body.paymentId || `PAY-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        transactionId: req.body.transactionId || `TXN-EXAM-${Date.now()}`,
        paymentProvider: req.body.paymentProvider || 'STRIPE',
        status: 'completed',
      }], { session });

      purchase = purchaseResult[0];

      await Exam.findByIdAndUpdate(exam._id, { $inc: { totalEnrolled: 1 } }, { session });

      await session.commitTransaction();

      logger.info({ purchaseId: purchase._id, examId: exam._id, studentId: user.id, amount: exam.price }, 'Exam purchased');
    } catch (transactionError) {
      await session.abortTransaction();
      throw transactionError;
    } finally {
      await session.endSession();
    }

    // Emit real-time revenue update to teacher via Socket.IO
    try {
      const io = getSocketIOInstance();
      if (io) {
        io.to(`teacher:monitoring:${exam._id}`).emit('teacher:revenue_update', {
          examId: exam._id.toString(),
          examTitle: exam.title,
          purchaseId: purchase._id.toString(),
          studentName: user.name,
          studentEmail: user.email,
          amount: exam.price,
          timestamp: new Date().toISOString(),
        });
        // Also emit to general teacher monitoring room
        io.to('teacher:monitoring').emit('teacher:revenue_update', {
          examId: exam._id.toString(),
          examTitle: exam.title,
          purchaseId: purchase._id.toString(),
          studentName: user.name,
          studentEmail: user.email,
          amount: exam.price,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (socketError) {
      logger.warn({ error: socketError }, 'Failed to emit revenue update via Socket.IO');
    }

    res.status(200).json({
      success: true,
      message: 'Exam purchased successfully! You can now participate.',
      data: purchase,
    });
  } catch (error) {
    logger.error({ error, examId: req.params.id, userId: req.user?.id }, 'Failed to process exam purchase');
    res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Failed to process exam purchase',
      error: error instanceof Error ? error.message : error,
    });
  }
};

export const submitExam = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const { answers = [], timeTakenSeconds } = req.body;

    if (user.role === 'teacher') {
      logger.warn({ userId: user.id, examId: id }, 'Teacher attempted to submit exam');
      res.status(403).json({
        success: false,
        code: 'TEACHER_ATTEMPT_FORBIDDEN',
        message: 'Teacher accounts are strictly forbidden from submitting examination responses.',
      });
      return;
    }

    const cleanId = (id || '').trim();
    let exam = null;
    if (mongoose.isValidObjectId(cleanId)) {
      exam = await Exam.findById(cleanId);
    }
    if (!exam) {
      const safeId = escapeRegExp(cleanId);
      exam = await Exam.findOne({
        $or: [
          { joinCode: new RegExp(`^${safeId}$`, 'i') },
          { accessToken: cleanId },
        ],
      });
    }
    if (!exam) {
      logger.warn({ examId: cleanId }, 'Exam not found for submission');
      res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Exam not found',
      });
      return;
    }

    const existingSubmission = await ExamSubmission.findOne({
      examId: exam._id,
      $or: [{ studentId: user.id }, { studentEmail: user.email }],
    });

    if (existingSubmission) {
      logger.warn({ examId: exam._id, studentId: user.id }, 'Duplicate submission attempt');
      res.status(403).json({
        success: false,
        code: 'ALREADY_COMPLETED',
        message: 'You have already attempted this examination. Only one attempt is permitted per account.',
      });
      return;
    }

    // Server-authoritative exam timing check
    const attempt = await ExamAttempt.findOne({
      examId: exam._id,
      studentId: user.id,
      status: 'in_progress',
    });

    if (attempt) {
      const now = new Date();
      if (attempt.expiresAt < now) {
        // Mark attempt as expired
        attempt.status = 'expired';
        await attempt.save();
        logger.warn({ examId: exam._id, studentId: user.id }, 'Submission rejected - exam expired');
        res.status(403).json({
          success: false,
          code: 'EXAM_EXPIRED',
          message: 'This examination has expired and can no longer be submitted.',
        });
        return;
      }
    } else if (exam.scheduleType === 'scheduled' && exam.endDateTime) {
      // For scheduled exams without an attempt, check the scheduled end time
      const end = new Date(exam.endDateTime);
      if (!isNaN(end.getTime()) && new Date() > end) {
        logger.warn({ examId: exam._id, studentId: user.id }, 'Submission rejected - scheduled exam expired');
        res.status(403).json({
          success: false,
          code: 'EXAM_EXPIRED',
          message: 'This examination has expired and is no longer accepting attempts.',
        });
        return;
      }
    }

    let score = 0;
    const evaluatedAnswers = answers.map((ans: any) => {
      const q = exam.questions.find((quest) => quest.id === ans.questionId || (quest as any)._id?.toString() === ans.questionId);

      let selectedIdx = typeof ans.selectedOptionIndex === 'number' ? ans.selectedOptionIndex : -1;
      if (selectedIdx === -1 && ans.submittedAnswer !== undefined) {
        const num = Number(ans.submittedAnswer);
        if (!isNaN(num) && num >= 0) {
          selectedIdx = num;
        } else if (q && Array.isArray(q.options)) {
          selectedIdx = q.options.findIndex((opt) => opt.trim().toLowerCase() === String(ans.submittedAnswer).trim().toLowerCase());
        }
      }

      const { isCorrect, marksObtained } = evaluateAnswer(q!, selectedIdx, ans.submittedAnswer);
      score += marksObtained;

      return {
        questionId: String(ans.questionId),
        selectedOptionIndex: Math.max(0, selectedIdx),
        submittedAnswer: ans.submittedAnswer !== undefined ? String(ans.submittedAnswer) : (q?.options?.[selectedIdx] || ''),
        isCorrect,
        marksObtained,
      };
    });

    const percentage = exam.totalMarks > 0 ? (score / exam.totalMarks) * 100 : 0;
    const isPassed = score >= exam.passMarks;
    const { grade, gradePoint } = calculateGrade(percentage);

    const submission = await ExamSubmission.create({
      studentId: user.id,
      studentName: user.name,
      studentEmail: user.email,
      examId: exam._id,
      answers: evaluatedAnswers,
      score,
      totalMarks: exam.totalMarks,
      percentage: Number(percentage.toFixed(2)),
      isPassed,
      grade,
      gradePoint,
      timeTakenSeconds: Number(timeTakenSeconds) || 0,
      submittedAt: new Date(),
    });

    const incObj: any = { completedCount: 1 };
    if (exam.accessType === 'free') {
      incObj.totalEnrolled = 1;
    }
    await Exam.findByIdAndUpdate(exam._id, { $inc: incObj });

    logger.info({ submissionId: submission._id, examId: exam._id, studentId: user.id, score, percentage, isPassed }, 'Exam submitted');
    res.status(200).json({
      success: true,
      message: isPassed
        ? 'Congratulations! You passed the exam.'
        : 'Exam submitted. You did not meet the pass mark.',
      result: {
        score,
        totalMarks: exam.totalMarks,
        percentage: Number(percentage.toFixed(2)),
        isPassed,
        submissionId: submission._id,
      },
    });
  } catch (error) {
    logger.error({ error, examId: req.params.id, userId: req.user?.id }, 'Failed to submit exam');
    res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Failed to submit exam',
      error: error instanceof Error ? error.message : error,
    });
  }
};

export const startExamAttempt = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { id } = req.params;

    if (user.role === 'teacher') {
      logger.warn({ userId: user.id, examId: id }, 'Teacher attempted to start exam');
      res.status(403).json({ success: false, message: 'Teachers cannot take exams' });
      return;
    }

    let exam = await Exam.findById(id);
    if (!exam && mongoose.isValidObjectId(id)) {
      exam = await Exam.findById(id);
    }
    if (!exam) {
      const safeId = escapeRegExp(id);
      exam = await Exam.findOne({ $or: [{ joinCode: new RegExp(`^${safeId}$`, 'i') }, { accessToken: id }] });
    }
    if (!exam) {
      logger.warn({ examId: id }, 'Exam not found for attempt');
      res.status(404).json({ success: false, message: 'Exam not found' });
      return;
    }

    const existingSubmission = await ExamSubmission.findOne({
      examId: exam._id,
      $or: [{ studentId: user.id }, { studentEmail: user.email }],
    });

    if (existingSubmission) {
      res.status(400).json({
        success: false,
        code: 'ALREADY_COMPLETED',
        message: 'Exam already submitted',
        submission: existingSubmission,
      });
      return;
    }

    let attempt = await ExamAttempt.findOne({
      examId: exam._id,
      studentId: user.id,
      status: 'in_progress',
    });

    const now = new Date();

    if (exam.scheduleType === 'scheduled' && exam.endDateTime) {
      const end = new Date(exam.endDateTime);
      if (!isNaN(end.getTime()) && now > end) {
        res.status(400).json({
          success: false,
          code: 'EXAM_EXPIRED',
          message: 'This examination has expired and is no longer accepting attempts.',
        });
        return;
      }
    }

    const durationMs = (exam.durationMinutes || 30) * 60 * 1000;

    if (!attempt) {
      const expiresAt = new Date(now.getTime() + durationMs);
      attempt = await ExamAttempt.create({
        studentId: user.id,
        studentName: user.name,
        studentEmail: user.email,
        examId: exam._id,
        startedAt: now,
        expiresAt,
        status: 'in_progress',
        proctoringData: {
          currentQuestionIndex: 0,
          answersCount: 0,
          cameraActive: true,
          tabSwitchCount: 0,
          faceDetected: true,
          lastPingAt: now,
        },
      });
    }

    const remainingMs = Math.max(0, attempt.expiresAt.getTime() - Date.now());

    logger.info({ attemptId: attempt._id, examId: exam._id, studentId: user.id }, 'Exam attempt started');
    res.status(200).json({
      success: true,
      data: {
        attemptId: attempt._id,
        examId: exam._id,
        startedAt: attempt.startedAt,
        expiresAt: attempt.expiresAt,
        durationMinutes: exam.durationMinutes,
        remainingSeconds: Math.floor(remainingMs / 1000),
        serverTime: new Date().toISOString(),
        isExpired: remainingMs <= 0,
      },
    });
  } catch (error) {
    logger.error({ error, examId: req.params.id, userId: req.user?.id }, 'Failed to start attempt');
    res.status(500).json({ success: false, message: 'Failed to start attempt', error });
  }
};

export const sendExamHeartbeat = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const { currentQuestionIndex, answersCount, cameraActive, tabSwitchCount, faceDetected } = req.body;

    const attempt = await ExamAttempt.findOne({
      examId: id,
      studentId: user.id,
      status: 'in_progress',
    });

    if (!attempt) {
      res.status(200).json({ success: true, isExpired: true });
      return;
    }

    const now = Date.now();
    const remainingMs = Math.max(0, attempt.expiresAt.getTime() - now);
    const isExpired = remainingMs <= 0;

    attempt.proctoringData = {
      currentQuestionIndex: typeof currentQuestionIndex === 'number' ? currentQuestionIndex : attempt.proctoringData.currentQuestionIndex,
      answersCount: typeof answersCount === 'number' ? answersCount : attempt.proctoringData.answersCount,
      cameraActive: typeof cameraActive === 'boolean' ? cameraActive : attempt.proctoringData.cameraActive,
      tabSwitchCount: typeof tabSwitchCount === 'number' ? tabSwitchCount : attempt.proctoringData.tabSwitchCount,
      faceDetected: typeof faceDetected === 'boolean' ? faceDetected : attempt.proctoringData.faceDetected,
      lastPingAt: new Date(),
    };

    if (isExpired) {
      attempt.status = 'expired';
    }

    await attempt.save();

    res.status(200).json({
      success: true,
      remainingSeconds: Math.floor(remainingMs / 1000),
      isExpired,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ error, examId: req.params.id, userId: req.user?.id }, 'Heartbeat error');
    res.status(500).json({ success: false, message: 'Heartbeat error', error });
  }
};

export const getMySubmissions = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const submissions = await ExamSubmission.find({
      $or: [{ studentId: user.id }, { studentEmail: user.email }],
    })
      .populate('examId', 'title category subject totalMarks passMarks accessType')
      .sort({ submittedAt: -1 });

    logger.info({ userId: user.id, count: submissions.length }, 'Student submissions fetched');
    res.status(200).json({
      success: true,
      count: submissions.length,
      data: submissions,
    });
  } catch (error) {
    logger.error({ error, userId: req.user?.id }, 'Failed to fetch student submissions');
    res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Failed to fetch your submissions',
      error: error instanceof Error ? error.message : error,
    });
  }
};

export const getMyPurchases = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const purchases = await ExamPurchase.find({
      $or: [{ studentId: user.id }, { studentEmail: user.email }],
      status: 'completed',
    })
      .populate('examId', 'title category durationMinutes totalMarks passMarks accessType price teacherName')
      .sort({ createdAt: -1 });

    const formatted = purchases.map((p: any) => ({
      id: p._id.toString(),
      transactionId: p.transactionId,
      paymentId: p.paymentId,
      studentId: p.studentId,
      studentName: p.studentName || user.name,
      studentEmail: p.studentEmail || user.email,
      examId: p.examId?._id ? p.examId._id.toString() : p.examId?.toString(),
      examTitle: p.examId?.title || 'Certified Examination Assessment',
      teacherId: p.teacherId,
      teacherName: p.teacherName || p.examId?.teacherName || 'Certified Instructor',
      teacherEmail: p.teacherEmail,
      pricePaid: p.pricePaid,
      paidAmount: p.pricePaid,
      amount: p.pricePaid,
      currency: 'USD',
      paymentProvider: p.paymentProvider || 'STRIPE',
      paymentStatus: 'SUCCESS',
      status: p.status,
      purchaseDate: p.createdAt ? p.createdAt.toISOString() : new Date().toISOString(),
      purchasedAt: p.createdAt ? p.createdAt.toISOString() : new Date().toISOString(),
      createdAt: p.createdAt ? p.createdAt.toISOString() : new Date().toISOString(),
      accessStatus: 'ACTIVE',
      exam: p.examId,
    }));

    logger.info({ userId: user.id, count: formatted.length }, 'Student purchases fetched');
    res.status(200).json({
      success: true,
      count: formatted.length,
      data: formatted,
    });
  } catch (error) {
    logger.error({ error, userId: req.user?.id }, 'Failed to fetch student purchases');
    res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Failed to fetch your purchases',
      error: error instanceof Error ? error.message : error,
    });
  }
};