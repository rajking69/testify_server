import { ExamAttempt } from '../models/exam-attempt.model';
import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { Exam } from '../models/exam.model';
import { ExamPurchase } from '../models/exam-purchase.model';
import { ExamSubmission } from '../models/exam-submission.model';
import { UserSubscription } from '../models/subscription.model';
import { evaluateAnswer, calculateGrade } from '../utils/exam.utils';
import { getSocketIOInstance } from '../app';

// Escape user input for safe use in RegExp
function escapeRegExp(input: string): string {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Helper to sanitize questions and prevent validation errors
const sanitizeQuestionsList = (questions: any[]): any[] => {
  if (!Array.isArray(questions)) return [];
  return questions.map((q, idx) => {
    const options = Array.isArray(q.options) ? q.options : [];
    let correctOptionIndex = typeof q.correctOptionIndex === 'number' ? q.correctOptionIndex : 0;
    if (q.correctAnswer && options.length > 0) {
      const foundIdx = options.indexOf(q.correctAnswer);
      if (foundIdx !== -1) {
        correctOptionIndex = foundIdx;
      }
    }
    return {
      ...q,
      id: String(q.id || q._id || ('q_' + idx + '_' + Date.now())),
      questionText: q.questionText || 'Question text',
      options,
      correctOptionIndex,
      marks: Number(q.marks) || 1,
      explanation: q.explanation || '',
    };
  });
};


// 1. GET /api/exams/public - Guest/Public list of ALL Published exams (Free & Paid)
export const getPublicExams = async (req: Request, res: Response): Promise<void> => {
  try {
    const { category, search } = req.query;
    const filter: any = {
      status: 'published',
    };

    if (category && category !== 'all' && category !== 'All') {
      const safeCategory = escapeRegExp(String(category));
      filter.$or = [
        { category: new RegExp(`^${safeCategory}$`, 'i') },
        { subject: new RegExp(`^${safeCategory}$`, 'i') },
      ];
    }

    if (search) {
      const safeSearch = escapeRegExp(String(search));
      filter.title = { $regex: safeSearch, $options: 'i' };
    }

    const exams = await Exam.find(filter)
      .select('-questions.correctOptionIndex -questions.explanation')
      .sort({ createdAt: -1 })
      .lean();

    const mappedExams = exams.map((exam: any) => {
      const sanitizedQuestions = (exam.questions || []).map((q: any) => ({
        _id: q._id || q.id,
        id: q.id || q._id,
        questionText: q.questionText,
        options: q.options,
        marks: q.marks,
      }));

      return {
        ...exam,
        id: exam._id.toString(),
        examId: exam._id.toString(),
        title: exam.title,
        description: exam.description,
        category: exam.category,
        duration: exam.durationMinutes,
        durationMinutes: exam.durationMinutes,
        totalMarks: exam.totalMarks,
        passMarks: exam.passMarks,
        passMark: exam.passMarks || Math.round((exam.totalMarks || 50) * 0.4),
        accessType: exam.accessType,
        price: exam.price || 0,
        teacherId: exam.teacherId,
        teacherName: exam.teacherName,
        createdBy: exam.teacherName || 'Instructor',
        isPublished: exam.isPublished !== false,
        isUnlocked: exam.accessType === 'free',
        enrolledCount: exam.totalEnrolled || 0,
        completedCount: exam.completedCount || 0,
        joinCode: exam.joinCode,
        accessToken: exam.accessToken,
        startDateTime: exam.startDateTime,
        endDateTime: exam.endDateTime,
        status: exam.status || (exam.isPublished ? 'published' : 'draft'),
        subject: exam.subject || exam.category || 'General',
        questions: sanitizedQuestions,
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
      code: 'INTERNAL_ERROR',
      message: 'Failed to fetch public exams',
      error: error instanceof Error ? error.message : error,
    });
  }
};

// 2. GET /api/exams - Logged in view of all exams with unlock and attempt status
export const getAllExams = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    const { category, subject, accessType, teacherId, teacherEmail, mine, isPublished, search } = req.query;

    const filter: any = {};

    // Teacher ownership & privacy: Teacher A cannot see Teacher B's unpublished drafts
    if (mine === 'true' && user) {
      filter.$or = [{ teacherId: user.id }, { teacherEmail: user.email }];
    } else if (teacherId) {
      if (user && (user.id === teacherId || user.role === 'admin')) {
        filter.teacherId = teacherId;
      } else {
        filter.teacherId = teacherId;
        filter.status = 'published';
      }
    } else if (teacherEmail) {
      if (user && (user.email === teacherEmail || user.role === 'admin')) {
        filter.teacherEmail = teacherEmail;
      } else {
        filter.teacherEmail = teacherEmail;
        filter.status = 'published';
      }
    } else if (isPublished !== undefined && user && user.role === 'admin') {
      filter.status = isPublished === 'true' ? 'published' : 'draft';
    } else if (!user || user.role === 'student') {
      filter.status = 'published';
    } else if (user.role === 'teacher') {
      // Teachers can see their own exams (draft or published) OR published exams from others
      filter.$or = [
        { status: 'published' },
        { teacherId: user.id },
        { teacherEmail: user.email },
      ];
    }

    const cat = category || subject;
    if (cat && cat !== 'all' && cat !== 'All') {
      const safeCat = escapeRegExp(String(cat));
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [
          { category: new RegExp(`^${safeCat}$`, 'i') },
          { subject: new RegExp(`^${safeCat}$`, 'i') },
        ],
      });
    }

    if (accessType && accessType !== 'all' && accessType !== 'All') {
      filter.accessType = String(accessType).toLowerCase();
    }

    if (search) {
      const safeSearch = escapeRegExp(String(search));
      const searchRegex = new RegExp(safeSearch, 'i');
      const searchOr = [
        { title: searchRegex },
        { description: searchRegex },
        { category: searchRegex },
        { subject: searchRegex },
      ];
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
        examId: exam._id.toString(),
        duration: exam.durationMinutes,
        subject: exam.subject || exam.category || 'General',
        status: exam.status || (exam.isPublished ? 'published' : 'draft'),
        createdBy: exam.teacherName || 'Instructor',
        teacherName: exam.teacherName || 'Instructor',
        enrolledCount: exam.totalEnrolled || 0,
        completedCount: exam.completedCount || 0,
        passMark: exam.passMarks || Math.round((exam.totalMarks || 50) * 0.4),
        isUnlocked: exam.accessType === 'free',
      }));

      res.status(200).json({
        success: true,
        count: mappedExams.length,
        data: mappedExams,
      });
      return;
    }

    // If student, check subscriptions & purchases & attempts
    if (user.role === 'student') {
      const now = new Date();
      const activeSubscription = await UserSubscription.findOne({
        userId: user.id,
        role: 'student',
        status: 'active',
        endDate: { $gt: now },
      });

      const purchases = await ExamPurchase.find({
        studentId: user.id,
        status: 'completed',
      }).select('examId');

      const purchasedExamIds = new Set(purchases.map((p) => p.examId.toString()));

      const submissions = await ExamSubmission.find({
        $or: [{ studentId: user.id }, { studentEmail: user.email }],
      }).select('examId');

      const submittedExamIds = new Set(submissions.map((s) => s.examId.toString()));

      const mappedExams = exams.map((exam: any) => {
        const examIdStr = exam._id.toString();
        const isUnlocked =
          exam.accessType === 'free' ||
          Boolean(activeSubscription) ||
          purchasedExamIds.has(examIdStr);

        return {
          ...exam,
          id: examIdStr,
          examId: examIdStr,
          duration: exam.durationMinutes,
          isUnlocked,
          isCompleted: submittedExamIds.has(examIdStr),
          joinCode: exam.joinCode,
          accessToken: exam.accessToken,
          startDateTime: exam.startDateTime,
          endDateTime: exam.endDateTime,
          status: exam.status || (exam.isPublished ? 'published' : 'draft'),
          subject: exam.subject || exam.category || 'General',
          createdBy: exam.teacherName || 'Instructor',
          teacherName: exam.teacherName || 'Instructor',
          enrolledCount: exam.totalEnrolled || 0,
          completedCount: exam.completedCount || 0,
          passMark: exam.passMarks || Math.round((exam.totalMarks || 50) * 0.4),
        };
      });

      res.status(200).json({
        success: true,
        count: mappedExams.length,
        data: mappedExams,
      });
      return;
    }

    // Teacher / Admin view
    const mappedExams = exams.map((exam: any) => ({
      ...exam,
      id: exam._id.toString(),
      examId: exam._id.toString(),
      duration: exam.durationMinutes,
      isUnlocked: true,
      subject: exam.subject || exam.category || 'General',
      status: exam.status || (exam.isPublished ? 'published' : 'draft'),
      createdBy: exam.teacherName || 'Instructor',
      teacherName: exam.teacherName || 'Instructor',
      enrolledCount: exam.totalEnrolled || 0,
      completedCount: exam.completedCount || 0,
      passMark: exam.passMarks || Math.round((exam.totalMarks || 50) * 0.4),
    }));

    res.status(200).json({
      success: true,
      count: mappedExams.length,
      data: mappedExams,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
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
    const cleanId = (id || '').trim();

    let exam = null;
    if (mongoose.isValidObjectId(cleanId)) {
      exam = await Exam.findById(cleanId);
    }
    if (!exam) {
      exam = await Exam.findOne({
        $or: [
          { joinCode: cleanId.toUpperCase() },
          { joinCode: cleanId },
          { accessToken: cleanId },
        ],
      });
    }
    if (!exam) {
      res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Exam not found',
      });
      return;
    }

    const isCreator = Boolean(
      user &&
      (exam.teacherId === user.id || (exam.teacherEmail && exam.teacherEmail === user.email))
    );
    const isAdmin = Boolean(user && user.role === 'admin');
    const isCreatorOrAdmin = isCreator || isAdmin;

    // If draft/unpublished, only creator or admin can view
    if (exam.status === 'draft' && !isCreatorOrAdmin) {
      res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Exam not found or is not currently published.',
      });
      return;
    }

    // Check if student has already submitted
    let existingSubmission = null;
    if (user) {
      existingSubmission = await ExamSubmission.findOne({
        examId: exam._id,
        $or: [{ studentId: user.id }, { studentEmail: user.email }],
      });
    }

    // Hide answers if not creator/admin
    const examData: any = exam.toObject();
    examData.id = exam._id.toString();
    examData.examId = exam._id.toString();
    examData.duration = exam.durationMinutes;
    examData.joinCode = (exam as any).joinCode;
    examData.accessToken = (exam as any).accessToken;
    examData.startDateTime = (exam as any).startDateTime;
    examData.endDateTime = (exam as any).endDateTime;
    examData.subject = exam.subject || exam.category || 'General';
    examData.status = exam.status || (exam.isPublished ? 'published' : 'draft');
    examData.enrolledCount = exam.totalEnrolled || 0;
    examData.completedCount = exam.completedCount || 0;
    examData.passMark = exam.passMarks;
    examData.teacherName = exam.teacherName;
    examData.createdBy = exam.teacherName;
    if (!isCreatorOrAdmin && examData.questions) {
      examData.questions = examData.questions.map((q: any) => ({
        _id: q._id || q.id,
        id: q.id || q._id,
        questionText: q.questionText,
        options: q.options,
        marks: q.marks,
      }));
    }

    examData.isCompleted = Boolean(existingSubmission);

    res.status(200).json({
      success: true,
      data: examData,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
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
      scheduleType = 'flexible',
      startDateTime,
      endDateTime,
      date,
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
      requireCamera,
    } = req.body;

    if (!title || !title.trim()) {
      res.status(400).json({
        success: false,
        code: 'INVALID_INPUT',
        message: 'Exam title is required',
      });
      return;
    }

    const chosenAccessType = String(accessType || 'free').toLowerCase() as 'free' | 'paid' | 'subscription_only';
    const chosenStatus = String(status || 'published').toLowerCase() as 'draft' | 'published' | 'scheduled';
    const computedIsPublished = isPublished !== undefined ? Boolean(isPublished) : chosenStatus !== 'draft';
    const totalM = Number(totalMarks) || 100;
    const computedPassMarks = Number(passMarks || passMark || Math.round((totalM * (Number(passPercentage) || 40)) / 100)) || 40;
    const chosenSubject = String(subject || category || 'General').trim();
    const chosenScheduleType = String(scheduleType || 'flexible').toLowerCase() === 'scheduled' ? 'scheduled' : 'flexible';

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

    // Validate question count (max 100 per exam)
    if (formattedQuestions.length > 100) {
      res.status(400).json({
        success: false,
        code: 'TOO_MANY_QUESTIONS',
        message: `Exam cannot have more than 100 questions. Provided: ${formattedQuestions.length}`,
      });
      return;
    }

    const newExam = await Exam.create({
      title: title.trim(),
      description: description.trim(),
      category: chosenSubject,
      subject: chosenSubject,
      scheduleType: chosenScheduleType,
      startDateTime,
      endDateTime,
      date: date || (startDateTime ? new Date(startDateTime).toLocaleString() : undefined),
      joinCode: (joinCode || Math.random().toString(36).substring(2, 8)).toUpperCase(),
      accessToken: accessToken || ('tst_' + Math.random().toString(36).substring(2, 12)),
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
      schedule: schedule || undefined,
      requireCamera: Boolean(requireCamera),
    });

    res.status(201).json({
      success: true,
      message: 'Exam created successfully',
      data: newExam,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Failed to create exam',
      error: error instanceof Error ? error.message : error,
    });
  }
};

// 5. PATCH /api/exams/:id - Update exam (Teacher Owner or Admin)
export const updateExam = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const user = req.user!;
    const cleanId = (id || '').trim();

    let exam = null;
    if (mongoose.isValidObjectId(cleanId)) {
      exam = await Exam.findById(cleanId);
    }
    if (!exam) {
      exam = await Exam.findOne({
        $or: [
          { joinCode: cleanId.toUpperCase() },
          { joinCode: cleanId },
          { accessToken: cleanId },
        ],
      });
    }

    // Upsert: If exam record not yet in MongoDB, create it now for the teacher
    if (!exam) {
      const {
        title,
        description,
        category,
        subject,
        accessType,
        price,
        durationMinutes,
        totalMarks,
        passMarks,
        questions,
        isPublished,
        startDateTime,
        endDateTime,
        date,
        joinCode,
        accessToken,
        status,
        schedule,
      } = req.body;

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

      const created = await Exam.create({
        _id: mongoose.isValidObjectId(cleanId) ? cleanId : undefined,
        title: title || 'Examination Paper',
        description: description || '',
        category: category || subject || 'General',
        subject: subject || category || 'General',
        teacherId: user.id,
        teacherName: user.name,
        teacherEmail: user.email,
        accessType: accessType || 'free',
        price: Number(price) || 0,
        durationMinutes: Number(durationMinutes) || 60,
        totalMarks: Number(totalMarks) || 50,
        passMarks: Number(passMarks) || 20,
        questions: formattedQuestions,
        isPublished: isPublished !== undefined ? Boolean(isPublished) : (status === 'PUBLISHED'),
        status: status || 'PUBLISHED',
        joinCode: (joinCode || (cleanId.length <= 10 ? cleanId : Math.random().toString(36).substring(2, 8))).toUpperCase(),
        accessToken: accessToken || ('tst_' + Math.random().toString(36).substring(2, 12)),
        startDateTime,
        endDateTime,
        date,
        schedule,
        requireCamera: Boolean(req.body.requireCamera),
      });

      res.status(200).json({
        success: true,
        message: 'Exam upserted and saved successfully',
        data: created,
      });
      return;
    }

    const isCreator =
      exam.teacherId === user.id || (exam.teacherEmail && exam.teacherEmail === user.email);
    const isAdmin = user.role === 'admin';

    if (!isCreator && !isAdmin) {
      res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: "You are not authorized to update another teacher's examination.",
      });
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
      startDateTime,
      endDateTime,
      date,
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
    if (req.body.scheduleType !== undefined) (exam as any).scheduleType = req.body.scheduleType === 'scheduled' ? 'scheduled' : 'flexible';
    if (startDateTime !== undefined) (exam as any).startDateTime = startDateTime;
    if (endDateTime !== undefined) (exam as any).endDateTime = endDateTime;
    if (date !== undefined) (exam as any).date = date;
    if (schedule !== undefined) exam.schedule = schedule;
    if (req.body.requireCamera !== undefined) exam.requireCamera = Boolean(req.body.requireCamera);

    if (Array.isArray(questions)) {
      const formattedQuestions = questions.map((q: any, idx: number) => ({
        id: String(q.id || q._id || `q_${Date.now()}_${idx}`),
        questionText: q.questionText || q.question || '',
        options: Array.isArray(q.options) ? q.options : [],
        correctOptionIndex: typeof q.correctOptionIndex === 'number' ? q.correctOptionIndex : 0,
        correctAnswer: String(q.correctAnswer || ''),
        marks: Number(q.marks) || 1,
        explanation: q.explanation || '',
      }));

      // Validate question count (max 100 per exam)
      if (formattedQuestions.length > 100) {
        res.status(400).json({
          success: false,
          code: 'TOO_MANY_QUESTIONS',
          message: `Exam cannot have more than 100 questions. Provided: ${formattedQuestions.length}`,
        });
        return;
      }

      exam.questions = formattedQuestions;
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
      code: 'INTERNAL_ERROR',
      message: 'Failed to update exam',
      error: error instanceof Error ? error.message : error,
    });
  }
};

// 6. DELETE /api/exams/:id - Delete exam (Teacher Owner or Admin)
export const deleteExam = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const user = req.user!;

    const exam = await Exam.findById(id);
    if (!exam) {
      res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Exam not found',
      });
      return;
    }

    const isCreator =
      exam.teacherId === user.id || (exam.teacherEmail && exam.teacherEmail === user.email);
    const isAdmin = user.role === 'admin';

    if (!isCreator && !isAdmin) {
      res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: "You are not authorized to delete another teacher's examination.",
      });
      return;
    }

    // Clean up related records (but preserve financial/audit records)
    await Promise.all([
      ExamAttempt.deleteMany({ examId: exam._id }),
      ExamSubmission.deleteMany({ examId: exam._id }),
      // Note: ExamPurchase records are preserved for financial audit trail
    ]);

    await Exam.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Exam deleted successfully',
      data: { id },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
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

    // Rule: Teachers cannot purchase exams
    if (user.role === 'teacher') {
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
      : await Exam.findOne({ $or: [{ joinCode: new RegExp(`^${id}$`, 'i') }, { accessToken: id }] });

    if (!exam) {
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
        code: 'ALREADY_PURCHASED',
        message: 'You have already purchased this exam.',
      });
      return;
    }

    // Record purchase with transaction for referential integrity
    const session = await mongoose.startSession();
    session.startTransaction();

    let purchase: any;

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
        console.warn('Failed to emit revenue update via Socket.IO:', socketError);
      }

      res.status(200).json({
        success: true,
        message: 'Exam purchased successfully! You can now participate.',
        data: purchase,
      });
    } catch (transactionError) {
      await session.abortTransaction();
      throw transactionError;
    } finally {
      await session.endSession();
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
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

    // Rule: Teachers cannot submit exam attempts
    if (user.role === 'teacher') {
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
      exam = await Exam.findOne({
        $or: [
          { joinCode: new RegExp(`^${cleanId}$`, 'i') },
          { accessToken: cleanId },
        ],
      });
    }
    if (!exam) {
      res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Exam not found',
      });
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
        res.status(403).json({
          success: false,
          code: 'EXAM_EXPIRED',
          message: 'This examination has expired and is no longer accepting attempts.',
        });
        return;
      }
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
      code: 'INTERNAL_ERROR',
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
      code: 'INTERNAL_ERROR',
      message: 'Failed to fetch your submissions',
      error: error instanceof Error ? error.message : error,
    });
  }
};

// 10. GET /api/exams/my/purchases - Get student's verified paid purchases and invoices
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

    res.status(200).json({
      success: true,
      count: formatted.length,
      data: formatted,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Failed to fetch your purchases',
      error: error instanceof Error ? error.message : error,
    });
  }
};


// 9. POST /api/exams/:id/start-attempt - Start or resume student exam attempt (Server-Side Timer)
export const startExamAttempt = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { id } = req.params;
    
    if (user.role === 'teacher') {
      res.status(403).json({ success: false, message: 'Teachers cannot take exams' });
      return;
    }

    let exam = await Exam.findById(id);
    if (!exam && mongoose.isValidObjectId(id)) {
      exam = await Exam.findById(id);
    }
    if (!exam) {
      exam = await Exam.findOne({ $or: [{ joinCode: new RegExp(`^${id}$`, 'i') }, { accessToken: id }] });
    }
    if (!exam) {
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

    // Check if scheduled exam is expired
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
    res.status(500).json({ success: false, message: 'Failed to start attempt', error });
  }
};

// 10. POST /api/exams/:id/heartbeat - Student ping with proctoring telemetry
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
    res.status(500).json({ success: false, message: 'Heartbeat error', error });
  }
};

// 11. GET /api/teacher/exams/:examId/live-monitoring - Teacher Live Real-Time Candidates
export const getLiveMonitoringData = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { examId } = req.params;

    const exam = await Exam.findById(examId);
    if (!exam) {
      res.status(404).json({ success: false, message: 'Exam not found' });
      return;
    }

    const attempts = await ExamAttempt.find({ examId }).sort({ updatedAt: -1 });
    const submissions = await ExamSubmission.find({ examId }).sort({ submittedAt: -1 });

    // Build submission lookup map for O(1) access - eliminates N+1 pattern
    const submissionMap = new Map<string, typeof submissions[0]>();
    for (const sub of submissions) {
      const key = sub.studentId || (sub.studentEmail ? sub.studentEmail.toLowerCase() : '');
      if (key) {
        submissionMap.set(key, sub);
      }
    }

    const now = Date.now();

    const liveCandidates = attempts.map((att) => {
      const remainingMs = Math.max(0, att.expiresAt.getTime() - now);
      const lastPingTime = att.proctoringData?.lastPingAt ? new Date(att.proctoringData.lastPingAt).getTime() : 0;
      const isOnline = lastPingTime > 0 && (now - lastPingTime < 35000);

      // O(1) lookup instead of O(n) find()
      const studentIdKey = att.studentId || '';
      const emailKey = att.studentEmail ? att.studentEmail.toLowerCase() : '';
      const sub = submissionMap.get(studentIdKey) || submissionMap.get(emailKey);

      return {
        attemptId: att._id,
        studentId: att.studentId,
        name: att.studentName,
        email: att.studentEmail,
        startedAt: att.startedAt,
        expiresAt: att.expiresAt,
        remainingSeconds: Math.floor(remainingMs / 1000),
        status: sub ? 'Completed' : (remainingMs <= 0 || att.status === 'expired' ? 'Expired' : 'In Progress'),
        isOnline: sub ? false : isOnline,
        progress: {
          answered: att.proctoringData?.answersCount || 0,
          total: exam.questions.length,
          currentQuestion: (att.proctoringData?.currentQuestionIndex || 0) + 1,
        },
        proctoring: {
          cameraActive: att.proctoringData?.cameraActive ?? true,
          faceDetected: att.proctoringData?.faceDetected ?? true,
          tabSwitchCount: att.proctoringData?.tabSwitchCount || 0,
        },
        score: sub ? sub.score : null,
        percentage: sub ? sub.percentage : null,
        isPassed: sub ? sub.isPassed : null,
      };
    });

    res.status(200).json({
      success: true,
      data: {
        examId: exam._id,
        examTitle: exam.title,
        totalQuestions: exam.questions.length,
        durationMinutes: exam.durationMinutes,
        totalAttempts: attempts.length,
        totalSubmissions: submissions.length,
        activeNow: liveCandidates.filter((c) => c.status === 'In Progress' && c.isOnline).length,
        candidates: liveCandidates,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch live monitoring data', error });
  }
};

// 12. GET /api/submissions/:id/transcript - Get Itemized Academic Transcript
export const getSubmissionTranscript = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const submission = await ExamSubmission.findById(id);

    if (!submission) {
      res.status(404).json({ success: false, message: 'Submission transcript not found' });
      return;
    }

    const exam = await Exam.findById(submission.examId);
    const percentage = submission.percentage || (submission.totalMarks > 0 ? (submission.score / submission.totalMarks) * 100 : 0);
    const { grade, gradePoint } = calculateGrade(percentage);

    res.status(200).json({
      success: true,
      data: {
        transcriptId: `TR-${submission._id.toString().slice(-8).toUpperCase()}`,
        student: {
          name: submission.studentName,
          email: submission.studentEmail,
          id: submission.studentId,
        },
        exam: {
          title: exam?.title || 'Academic Examination',
          category: exam?.category || 'General',
          subject: exam?.subject || 'Assessment',
          teacherName: exam?.teacherName || 'Instructor',
          durationMinutes: exam?.durationMinutes || 30,
        },
        results: {
          score: submission.score,
          totalMarks: submission.totalMarks,
          percentage: Number(percentage.toFixed(2)),
          grade,
          gradePoint,
          isPassed: submission.isPassed,
          timeTakenSeconds: submission.timeTakenSeconds || 0,
          submittedAt: submission.submittedAt,
        },
        answers: submission.answers,
        questions: exam?.questions || [],
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch transcript', error });
  }
};


// 13. GET /api/teacher/submissions/all - Get all submissions for teacher's exams
export const getTeacherExamsSubmissions = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const teacherExams = await Exam.find({
      $or: [{ teacherId: user.id }, { teacherEmail: user.email }],
    });

    // Build exam lookup map for O(1) access - eliminates N+1 pattern
    const examMap = new Map<string, typeof teacherExams[0]>();
    for (const exam of teacherExams) {
      examMap.set(exam._id.toString(), exam);
    }

    const examIds = teacherExams.map((e) => e._id);
    const submissions = await ExamSubmission.find({ examId: { $in: examIds } }).sort({ submittedAt: -1 });

    const formatted = submissions.map((sub) => {
      // O(1) lookup instead of O(n) find()
      const exam = examMap.get(sub.examId.toString());
      return {
        id: sub._id,
        submissionId: sub._id,
        examId: sub.examId,
        studentId: sub.studentId,
        studentName: sub.studentName,
        studentEmail: sub.studentEmail,
        examTitle: exam?.title || 'Examination',
        subject: exam?.subject || 'Assessment',
        category: exam?.category || 'General',
        score: sub.score,
        totalMarks: sub.totalMarks,
        percentage: sub.percentage,
        grade: sub.grade || (sub.percentage >= 80 ? 'A+' : sub.percentage >= 70 ? 'A' : sub.percentage >= 60 ? 'B' : sub.percentage >= 50 ? 'C' : 'F'),
        gradePoint: sub.gradePoint || (sub.percentage >= 80 ? 4.0 : sub.percentage >= 70 ? 3.5 : sub.percentage >= 60 ? 3.0 : sub.percentage >= 50 ? 2.0 : 0.0),
        isPassed: sub.isPassed,
        timeTakenSeconds: sub.timeTakenSeconds || 0,
        submittedAt: sub.submittedAt,
      };
    });

    res.status(200).json({
      success: true,
      count: formatted.length,
      data: formatted,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch teacher submissions', error });
  }
};
