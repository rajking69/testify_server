import { Request, Response } from 'express';
import { Exam } from '../models/exam.model';
import { ExamPurchase } from '../models/exam-purchase.model';
import { ExamSubmission } from '../models/exam-submission.model';
import { UserSubscription } from '../models/subscription.model';

// 1. GET /api/exams/public - Guest/Public list of Free exams ONLY
export const getPublicExams = async (req: Request, res: Response): Promise<void> => {
  try {
    const exams = await Exam.find({
      isPublished: true,
      accessType: 'free',
    })
      .select('-questions.correctOptionIndex -questions.explanation')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: exams.length,
      data: exams,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch public exams',
      error: error instanceof Error ? error.message : error,
    });
  }
};

// 2. GET /api/exams - Logged in view of all exams with unlock status
export const getAllExams = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    const { category, accessType } = req.query;

    const filter: any = { isPublished: true };
    if (category) filter.category = category;
    if (accessType) filter.accessType = accessType;

    const exams = await Exam.find(filter)
      .select('-questions.correctOptionIndex -questions.explanation')
      .sort({ createdAt: -1 })
      .lean();

    if (!user) {
      // Unauthenticated users see all published exams, with unlock status based on free access
      const mappedExams = exams.map((exam) => ({
        ...exam,
        isUnlocked: exam.accessType === 'free',
      }));
      res.status(200).json({ success: true, count: mappedExams.length, data: mappedExams });
      return;
    }

    // Check student subscription
    const now = new Date();
    const hasStudentSubscription =
      user.role === 'admin' ||
      (await UserSubscription.exists({
        userId: user.id,
        role: 'student',
        status: 'active',
        endDate: { $gt: now },
      }));

    // Get all purchases for this student
    const purchasedExamIds = (
      await ExamPurchase.find({
        studentId: user.id,
        status: 'completed',
      }).select('examId')
    ).map((p) => p.examId.toString());

    // Map unlock status
    const mappedExams = exams.map((exam) => {
      const isCreator = user.role === 'teacher' && exam.teacherId === user.id;
      const isUnlocked =
        user.role === 'admin' ||
        isCreator ||
        exam.accessType === 'free' ||
        !!hasStudentSubscription ||
        purchasedExamIds.includes(exam._id.toString());

      return {
        ...exam,
        isUnlocked,
      };
    });

    res.status(200).json({
      success: true,
      count: mappedExams.length,
      data: mappedExams,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch exams',
      error: error instanceof Error ? error.message : error,
    });
  }
};

// 3. GET /api/exams/:id - Get single exam details
export const getExamById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const user = req.user;

    const exam = await Exam.findById(id);
    if (!exam) {
      res.status(404).json({ success: false, message: 'Exam not found' });
      return;
    }

    // Check if user has already submitted (if authenticated)
    let existingSubmission = null;
    if (user) {
      existingSubmission = await ExamSubmission.findOne({
        examId: exam._id,
        $or: [{ studentId: user.id }, { studentEmail: user.email }],
      });
    }

    const isCreatorOrAdmin =
      user && (user.role === 'admin' || (user.role === 'teacher' && exam.teacherId === user.id));

    // Hide answers if not creator/admin
    const examData: any = exam.toObject();
    if (!isCreatorOrAdmin && examData.questions) {
      examData.questions = examData.questions.map((q: any) => ({
        _id: q._id || q.id,
        id: q.id || q._id,
        questionText: q.questionText,
        options: q.options,
        marks: q.marks,
      }));
    }

    res.status(200).json({
      success: true,
      data: examData,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch exam details',
      error: error instanceof Error ? error.message : error,
    });
  }
};

// 4. POST /api/exams - Create exam (Teacher with Active Subscription)
export const createExam = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const {
      title,
      description,
      category,
      accessType = 'free',
      price = 0,
      durationMinutes = 30,
      totalMarks = 100,
      passMarks = 40,
      questions = [],
      isPublished = true,
    } = req.body;

    if (!title) {
      res.status(400).json({ success: false, message: 'Exam title is required' });
      return;
    }

    const newExam = await Exam.create({
      title,
      description,
      category,
      teacherId: user.id,
      teacherName: user.name,
      teacherEmail: user.email,
      accessType,
      price: accessType === 'paid' ? Number(price) : 0,
      durationMinutes,
      totalMarks,
      passMarks,
      questions,
      isPublished,
    });

    res.status(201).json({
      success: true,
      message: 'Exam created successfully',
      data: newExam,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to create exam',
      error: error instanceof Error ? error.message : error,
    });
  }
};

// 5. POST /api/exams/:id/purchase - Direct one-time purchase of a special exam
export const purchaseExam = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { id } = req.params;

    const exam = await Exam.findById(id);
    if (!exam) {
      res.status(404).json({ success: false, message: 'Exam not found' });
      return;
    }

    if (exam.accessType === 'free') {
      res.status(400).json({ success: false, message: 'This is a free exam. No purchase required.' });
      return;
    }

    // Check if student has already completed and submitted this exam
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

    // Check existing purchase
    const existing = await ExamPurchase.findOne({
      studentId: user.id,
      examId: exam._id,
      status: 'completed',
    });

    if (existing) {
      res.status(400).json({
        success: false,
        message: 'You have already purchased this exam.',
      });
      return;
    }

    // Record purchase (mock transaction completion for now)
    const purchase = await ExamPurchase.create({
      studentId: user.id,
      studentEmail: user.email,
      studentName: user.name,
      examId: exam._id,
      pricePaid: exam.price,
      paymentId: `PAY-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      status: 'completed',
    });

    // Increment enrollment count
    await Exam.findByIdAndUpdate(exam._id, { $inc: { totalEnrolled: 1 } });

    res.status(200).json({
      success: true,
      message: 'Exam purchased successfully! You can now participate.',
      data: purchase,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to process exam purchase',
      error: error instanceof Error ? error.message : error,
    });
  }
};

// 6. POST /api/exams/:id/submit - Submit exam answers and calculate score
export const submitExam = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const { answers = [], timeTakenSeconds } = req.body;

    const exam = await Exam.findById(id);
    if (!exam) {
      res.status(404).json({ success: false, message: 'Exam not found' });
      return;
    }

    // 1-attempt guard: check if student has already completed this exam
    const existingSubmission = await ExamSubmission.findOne({
      examId: exam._id,
      $or: [{ studentId: user.id }, { studentEmail: user.email }],
    });

    if (existingSubmission) {
      res.status(403).json({
        success: false,
        code: 'ALREADY_COMPLETED',
        message: 'You have already attempted this examination. Only one attempt is permitted per account.',
      });
      return;
    }

    // Evaluate answers
    let score = 0;
    const evaluatedAnswers = answers.map((ans: { questionId: string; selectedOptionIndex: number }) => {
      const q = exam.questions.find((quest) => quest.id === ans.questionId);
      const isCorrect = q ? q.correctOptionIndex === ans.selectedOptionIndex : false;
      const marksObtained = isCorrect ? (q?.marks || 1) : 0;
      score += marksObtained;

      return {
        questionId: ans.questionId,
        selectedOptionIndex: ans.selectedOptionIndex,
        isCorrect,
        marksObtained,
      };
    });

    const percentage = exam.totalMarks > 0 ? (score / exam.totalMarks) * 100 : 0;
    const isPassed = score >= exam.passMarks;

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
      timeTakenSeconds,
      submittedAt: new Date(),
    });

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
    res.status(500).json({
      success: false,
      message: 'Failed to submit exam',
      error: error instanceof Error ? error.message : error,
    });
  }
};

// 7. GET /api/exams/my/submissions - Get student's past submissions
export const getMySubmissions = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const submissions = await ExamSubmission.find({ studentId: user.id })
      .populate('examId', 'title category totalMarks passMarks accessType')
      .sort({ submittedAt: -1 });

    res.status(200).json({
      success: true,
      count: submissions.length,
      data: submissions,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch your submissions',
      error: error instanceof Error ? error.message : error,
    });
  }
};
