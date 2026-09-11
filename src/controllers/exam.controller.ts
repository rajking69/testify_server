import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { Exam } from '../models/exam.model';
import { ExamPurchase } from '../models/exam-purchase.model';
import { ExamSubmission } from '../models/exam-submission.model';
import { UserSubscription } from '../models/subscription.model';

// 1. GET /api/exams/public - Guest/Public list of Free exams ONLY
export const getPublicExams = async (req: Request, res: Response): Promise<void> => {
  try {
    const { category, search } = req.query;
    const filter: any = {
      isPublished: { $ne: false },
      accessType: 'free',
    };

    if (category && category !== 'all' && category !== 'All') {
      filter.$or = [
        { category: new RegExp(`^${category}$`, 'i') },
        { subject: new RegExp(`^${category}$`, 'i') },
      ];
    }

    if (search) {
      filter.title = { $regex: String(search), $options: 'i' };
    }

    const exams = await Exam.find(filter)
      .select('-questions.correctOptionIndex -questions.explanation')
      .sort({ createdAt: -1 })
      .lean();

    const mappedExams = exams.map((exam: any) => ({
      ...exam,
      id: exam._id.toString(),
      subject: exam.subject || exam.category || 'General',
      status: exam.status || (exam.isPublished ? 'published' : 'draft'),
      createdBy: exam.teacherName || 'Instructor',
      enrolledCount: exam.totalEnrolled || 0,
      completedCount: exam.completedCount || 0,
      passMark: exam.passMarks || Math.round((exam.totalMarks || 50) * 0.4),
      isUnlocked: true,
    }));

    res.status(200).json({
      success: true,
      count: mappedExams.length,
      data: mappedExams,
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
    const { category, subject, accessType, teacherId, teacherEmail, mine, isPublished, search } = req.query;

    const filter: any = {};

    if (mine === 'true' && user) {
      filter.$or = [{ teacherId: user.id }, { teacherEmail: user.email }];
    } else if (teacherId) {
      filter.teacherId = teacherId;
    } else if (teacherEmail) {
      filter.teacherEmail = teacherEmail;
    }

    if (isPublished !== undefined) {
      filter.isPublished = isPublished === 'true';
    } else if (!user || user.role === 'student') {
      filter.isPublished = { $ne: false };
    }

    const cat = category || subject;
    if (cat && cat !== 'all' && cat !== 'All') {
      const catRegex = new RegExp(`^${cat}$`, 'i');
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [{ category: catRegex }, { subject: catRegex }],
      });
    }

    if (accessType && accessType !== 'all' && accessType !== 'All') {
      filter.accessType = String(accessType).toLowerCase();
    }

    if (search) {
      const searchRegex = new RegExp(String(search), 'i');
      const searchOr = [{ title: searchRegex }, { description: searchRegex }, { category: searchRegex }, { subject: searchRegex }];
      if (filter.$or) {
        filter.$and = filter.$and || [];
        filter.$and.push({ $or: filter.$or }, { $or: searchOr });
        delete filter.$or;
      } else {
        filter.$or = searchOr;
      }
    }

    const exams = await Exam.find(filter)
      .select('-questions.correctOptionIndex -questions.explanation')
      .sort({ createdAt: -1 })
      .lean();

    if (!user) {
      const mappedExams = exams.map((exam: any) => ({
        ...exam,
        id: exam._id.toString(),
        subject: exam.subject || exam.category || 'General',
        status: exam.status || (exam.isPublished ? 'published' : 'draft'),
        createdBy: exam.teacherName || 'Instructor',
        teacherName: exam.teacherName || 'Instructor',
        enrolledCount: exam.totalEnrolled || 0,
        completedCount: exam.completedCount || 0,
        passMark: exam.passMarks || Math.round((exam.totalMarks || 50) * 0.4),
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
    const mappedExams = exams.map((exam: any) => {
      const isCreator =
        user.role === 'admin' ||
        (user.role === 'teacher' && (exam.teacherId === user.id || exam.teacherEmail === user.email));
      const isUnlocked =
        user.role === 'admin' ||
        isCreator ||
        exam.accessType === 'free' ||
        !!hasStudentSubscription ||
        purchasedExamIds.includes(exam._id.toString());

      return {
        ...exam,
        id: exam._id.toString(),
        subject: exam.subject || exam.category || 'General',
        status: exam.status || (exam.isPublished ? 'published' : 'draft'),
        createdBy: exam.teacherName || 'Instructor',
        teacherName: exam.teacherName || 'Instructor',
        enrolledCount: exam.totalEnrolled || 0,
        completedCount: exam.completedCount || 0,
        passMark: exam.passMarks || Math.round((exam.totalMarks || 50) * 0.4),
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

// 3. GET /api/exams/:id - Get single exam details (supports ObjectId, joinCode, or accessToken)
export const getExamById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const user = req.user;

    const isValidId = mongoose.isValidObjectId(id);
    const query = isValidId
      ? { _id: id }
      : { $or: [{ joinCode: new RegExp(`^${id}$`, 'i') }, { accessToken: id }] };

    const exam = await Exam.findOne(query);
    if (!exam) {
      res.status(404).json({ success: false, message: 'Exam not found' });
      return;
    }

    const isCreatorOrAdmin =
      user && (user.role === 'admin' || (user.role === 'teacher' && (exam.teacherId === user.id || exam.teacherEmail === user.email)));

    const examData: any = exam.toObject();
    examData.id = exam._id.toString();
    examData.subject = exam.subject || exam.category || 'General';
    examData.status = exam.status || (exam.isPublished ? 'published' : 'draft');
    examData.enrolledCount = exam.totalEnrolled || 0;
    examData.completedCount = exam.completedCount || 0;
    examData.passMark = exam.passMarks;
    examData.teacherName = exam.teacherName;
    examData.createdBy = exam.teacherName;

    // Hide answers if not creator/admin
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

// 4. POST /api/exams - Create exam (Teacher with Active Subscription or Admin)
export const createExam = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const {
      title,
      description = '',
      category = 'General',
      subject,
      accessType = 'free',
      status = 'published',
      price = 0,
      durationMinutes = 30,
      totalMarks = 100,
      passMarks,
      passMark,
      passPercentage = 40,
      questions = [],
      isPublished,
      joinCode,
      accessToken,
      schedule,
    } = req.body;

    if (!title || !title.trim()) {
      res.status(400).json({ success: false, message: 'Exam title is required' });
      return;
    }

    const chosenAccessType = String(accessType || 'free').toLowerCase() as 'free' | 'paid' | 'subscription_only';
    const chosenStatus = String(status || 'published').toLowerCase() as 'draft' | 'published' | 'scheduled';
    const computedIsPublished = isPublished !== undefined ? Boolean(isPublished) : chosenStatus !== 'draft';
    const totalM = Number(totalMarks) || 100;
    const computedPassMarks = Number(passMarks || passMark || Math.round((totalM * (Number(passPercentage) || 40)) / 100)) || 40;
    const chosenSubject = String(subject || category || 'General').trim();

    const formattedQuestions = Array.isArray(questions)
      ? questions.map((q: any, idx: number) => ({
          id: String(q.id || q._id || `q_${Date.now()}_${idx}`),
          questionText: q.questionText || q.question || '',
          options: Array.isArray(q.options) ? q.options : [],
          correctOptionIndex: typeof q.correctOptionIndex === 'number' ? q.correctOptionIndex : 0,
          correctAnswer: String(q.correctAnswer || ''),
          marks: Number(q.marks) || 1,
          explanation: q.explanation || '',
        }))
      : [];

    const newExam = await Exam.create({
      title: title.trim(),
      description: description.trim(),
      category: chosenSubject,
      subject: chosenSubject,
      teacherId: user.id,
      teacherName: user.name || 'Instructor',
      teacherEmail: user.email,
      accessType: chosenAccessType,
      status: chosenStatus,
      price: chosenAccessType === 'paid' ? Number(price) || 0 : 0,
      durationMinutes: Number(durationMinutes) || 30,
      totalMarks: totalM,
      passMarks: computedPassMarks,
      questions: formattedQuestions,
      isPublished: computedIsPublished,
      joinCode: joinCode || undefined,
      accessToken: accessToken || undefined,
      schedule: schedule || undefined,
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

// 5. PATCH /api/exams/:id - Update exam (Creator Teacher or Admin)
export const updateExam = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { id } = req.params;

    const exam = await Exam.findById(id);
    if (!exam) {
      res.status(404).json({ success: false, message: 'Exam not found' });
      return;
    }

    const isCreatorOrAdmin =
      user.role === 'admin' ||
      (user.role === 'teacher' && (exam.teacherId === user.id || exam.teacherEmail === user.email));

    if (!isCreatorOrAdmin) {
      res.status(403).json({ success: false, message: 'Not authorized to update this exam' });
      return;
    }

    const {
      title,
      description,
      category,
      subject,
      accessType,
      status,
      price,
      durationMinutes,
      totalMarks,
      passMarks,
      passMark,
      passPercentage,
      questions,
      isPublished,
      joinCode,
      accessToken,
      schedule,
    } = req.body;

    if (title !== undefined) exam.title = String(title).trim();
    if (description !== undefined) exam.description = String(description).trim();
    if (subject !== undefined || category !== undefined) {
      const s = String(subject || category || exam.subject || exam.category).trim();
      exam.subject = s;
      exam.category = s;
    }
    if (accessType !== undefined) {
      const a = String(accessType).toLowerCase() as 'free' | 'paid' | 'subscription_only';
      exam.accessType = a;
      if (a !== 'paid') exam.price = 0;
    }
    if (price !== undefined && exam.accessType === 'paid') {
      exam.price = Number(price) || 0;
    }
    if (durationMinutes !== undefined) exam.durationMinutes = Number(durationMinutes) || 30;
    if (totalMarks !== undefined) exam.totalMarks = Number(totalMarks) || 100;
    if (passMarks !== undefined || passMark !== undefined || passPercentage !== undefined) {
      exam.passMarks = Number(passMarks || passMark || Math.round((exam.totalMarks * (Number(passPercentage) || 40)) / 100)) || 40;
    }
    if (status !== undefined) {
      const st = String(status).toLowerCase() as 'draft' | 'published' | 'scheduled';
      exam.status = st;
      exam.isPublished = st !== 'draft';
    } else if (isPublished !== undefined) {
      exam.isPublished = Boolean(isPublished);
      exam.status = exam.isPublished ? 'published' : 'draft';
    }
    if (joinCode !== undefined) exam.joinCode = joinCode;
    if (accessToken !== undefined) exam.accessToken = accessToken;
    if (schedule !== undefined) exam.schedule = schedule;

    if (Array.isArray(questions)) {
      exam.questions = questions.map((q: any, idx: number) => ({
        id: String(q.id || q._id || `q_${Date.now()}_${idx}`),
        questionText: q.questionText || q.question || '',
        options: Array.isArray(q.options) ? q.options : [],
        correctOptionIndex: typeof q.correctOptionIndex === 'number' ? q.correctOptionIndex : 0,
        correctAnswer: String(q.correctAnswer || ''),
        marks: Number(q.marks) || 1,
        explanation: q.explanation || '',
      }));
    }

    await exam.save();

    res.status(200).json({
      success: true,
      message: 'Exam updated successfully',
      data: exam,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update exam',
      error: error instanceof Error ? error.message : error,
    });
  }
};

// 6. DELETE /api/exams/:id - Delete exam (Creator Teacher or Admin)
export const deleteExam = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { id } = req.params;

    const exam = await Exam.findById(id);
    if (!exam) {
      res.status(404).json({ success: false, message: 'Exam not found' });
      return;
    }

    const isCreatorOrAdmin =
      user.role === 'admin' ||
      (user.role === 'teacher' && (exam.teacherId === user.id || exam.teacherEmail === user.email));

    if (!isCreatorOrAdmin) {
      res.status(403).json({ success: false, message: 'Not authorized to delete this exam' });
      return;
    }

    await Exam.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Exam deleted successfully',
      data: { id },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete exam',
      error: error instanceof Error ? error.message : error,
    });
  }
};

// 7. POST /api/exams/:id/purchase - Direct one-time purchase of a special exam
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

    // Record purchase
    const purchase = await ExamPurchase.create({
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

// 8. POST /api/exams/:id/submit - Submit exam answers and calculate score
export const submitExam = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const { answers = [], timeTakenSeconds } = req.body;

    const isValidId = mongoose.isValidObjectId(id);
    const query = isValidId
      ? { _id: id }
      : { $or: [{ joinCode: new RegExp(`^${id}$`, 'i') }, { accessToken: id }] };

    const exam = await Exam.findOne(query);
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

      let isCorrect = false;
      if (q) {
        if (q.correctOptionIndex !== undefined && selectedIdx >= 0 && q.correctOptionIndex === selectedIdx) {
          isCorrect = true;
        } else if (q.correctAnswer && ans.submittedAnswer && String(q.correctAnswer).trim().toLowerCase() === String(ans.submittedAnswer).trim().toLowerCase()) {
          isCorrect = true;
        } else if (q.correctOptionIndex !== undefined && q.options && q.options[q.correctOptionIndex]) {
          const correctText = String(q.options[q.correctOptionIndex]).trim().toLowerCase();
          if (ans.submittedAnswer && String(ans.submittedAnswer).trim().toLowerCase() === correctText) {
            isCorrect = true;
          }
        }
      }

      const marksObtained = isCorrect ? (q?.marks || 1) : 0;
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
      timeTakenSeconds: Number(timeTakenSeconds) || 0,
      submittedAt: new Date(),
    });

    // Increment completed count and enrollments
    const incObj: any = { completedCount: 1 };
    if (exam.accessType === 'free') {
      incObj.totalEnrolled = 1;
    }
    await Exam.findByIdAndUpdate(exam._id, { $inc: incObj });

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

// 9. GET /api/exams/my/submissions - Get student's past submissions
export const getMySubmissions = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const submissions = await ExamSubmission.find({
      $or: [{ studentId: user.id }, { studentEmail: user.email }],
    })
      .populate('examId', 'title category subject totalMarks passMarks accessType')
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
