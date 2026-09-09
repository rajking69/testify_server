import { Request, Response } from 'express';
import { Exam } from '../models/exam.model';
import { ExamPurchase } from '../models/exam-purchase.model';
import { ExamSubmission } from '../models/exam-submission.model';
import { UserSubscription } from '../models/subscription.model';

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
      isPublished: { $ne: false },
    };

    if (category && category !== 'all' && category !== 'All') {
      filter.category = new RegExp(`^${category}$`, 'i');
    }

    if (search) {
      filter.title = { $regex: String(search), $options: 'i' };
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
        accessType: exam.accessType,
        price: exam.price || 0,
        teacherId: exam.teacherId,
        teacherName: exam.teacherName,
        isPublished: exam.isPublished !== false,
        isUnlocked: exam.accessType === 'free',
        joinCode: exam.joinCode,
        accessToken: exam.accessToken,
        startDateTime: exam.startDateTime,
        endDateTime: exam.endDateTime,
        status: exam.status,
        subject: exam.subject || exam.category,
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
    const { category, accessType, teacherId, teacherEmail, mine, isPublished, search } = req.query;

    const filter: any = {};

    // Teacher ownership & privacy: Teacher A cannot see Teacher B's unpublished drafts
    if (mine === 'true' && user) {
      filter.$or = [{ teacherId: user.id }, { teacherEmail: user.email }];
    } else if (teacherId) {
      if (user && (user.id === teacherId || user.role === 'admin')) {
        filter.teacherId = teacherId;
      } else {
        filter.teacherId = teacherId;
        filter.isPublished = { $ne: false };
      }
    } else if (teacherEmail) {
      if (user && (user.email === teacherEmail || user.role === 'admin')) {
        filter.teacherEmail = teacherEmail;
      } else {
        filter.teacherEmail = teacherEmail;
        filter.isPublished = { $ne: false };
      }
    } else if (isPublished !== undefined && user && user.role === 'admin') {
      filter.isPublished = isPublished === 'true';
    } else if (!user || user.role === 'student') {
      filter.isPublished = { $ne: false };
    } else if (user.role === 'teacher') {
      // Teachers can see their own exams (draft or published) OR published exams from others
      filter.$or = [
        { isPublished: { $ne: false } },
        { teacherId: user.id },
        { teacherEmail: user.email },
      ];
    }

    if (category && category !== 'all' && category !== 'All') {
      filter.category = new RegExp(`^${category}$`, 'i');
    }

    if (accessType && accessType !== 'all' && accessType !== 'All') {
      filter.accessType = accessType;
    }

    if (search) {
      const searchRegex = new RegExp(String(search), 'i');
      const searchCond = [{ title: searchRegex }, { description: searchRegex }, { category: searchRegex }];
      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, { $or: searchCond }];
        delete filter.$or;
      } else {
        filter.$or = searchCond;
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
          status: exam.status,
          subject: exam.subject || exam.category,
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

// 3. GET /api/exams/:id - View exam details
export const getExamById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const user = req.user;
    const cleanId = (id || '').trim();

    let exam = null;
    if (cleanId.match(/^[0-9a-fA-F]{24}$/)) {
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
    if (exam.isPublished === false && (exam as any).status !== 'PUBLISHED' && !isCreatorOrAdmin) {
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
    examData.subject = (exam as any).subject || exam.category;
    examData.status = (exam as any).status || (exam.isPublished ? 'PUBLISHED' : 'DRAFT');

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

// 4. POST /api/exams - Create exam (Teacher with Active Subscription)
export const createExam = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const {
      title,
      description,
      category,
      subject,
      startDateTime,
      endDateTime,
      date,
      joinCode,
      accessToken,
      status,
      accessType = 'free',
      price = 0,
      durationMinutes = 30,
      totalMarks = 100,
      passMarks = 40,
      questions = [],
      isPublished = true,
    } = req.body;

    if (!title) {
      res.status(400).json({
        success: false,
        code: 'INVALID_INPUT',
        message: 'Exam title is required',
      });
      return;
    }

    const newExam = await Exam.create({
      title,
      description,
      category: category || subject || 'General',
      subject: subject || category || 'General',
      startDateTime,
      endDateTime,
      date: date || (startDateTime ? new Date(startDateTime).toLocaleString() : undefined),
      joinCode: (joinCode || Math.random().toString(36).substring(2, 8)).toUpperCase(),
      accessToken: accessToken || ('tst_' + Math.random().toString(36).substring(2, 12)),
      status: status || 'PUBLISHED',
      teacherId: user.id,
      teacherName: user.name,
      teacherEmail: user.email,
      accessType,
      price: accessType === 'paid' ? Number(price) : 0,
      durationMinutes: Number(durationMinutes) || 30,
      totalMarks: Number(totalMarks) || 100,
      passMarks: Number(passMarks) || 40,
      questions: sanitizeQuestionsList(questions),
      isPublished: Boolean(isPublished),
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
    if (cleanId.match(/^[0-9a-fA-F]{24}$/)) {
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
      } = req.body;

      const created = await Exam.create({
        _id: cleanId.match(/^[0-9a-fA-F]{24}$/) ? cleanId : undefined,
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
        questions: sanitizeQuestionsList(questions || []),
        isPublished: isPublished !== undefined ? Boolean(isPublished) : (status === 'PUBLISHED'),
        status: status || 'PUBLISHED',
        joinCode: (joinCode || cleanId.length <= 10 ? cleanId : Math.random().toString(36).substring(2, 8)).toUpperCase(),
        accessToken: accessToken || ('tst_' + Math.random().toString(36).substring(2, 12)),
        startDateTime,
        endDateTime,
        date,
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
      accessType,
      price,
      durationMinutes,
      totalMarks,
      passMarks,
      questions,
      isPublished,
    } = req.body;

    if (title !== undefined) exam.title = title;
    if (description !== undefined) exam.description = description;
    if (category !== undefined) exam.category = category;
    if (req.body.subject !== undefined) (exam as any).subject = req.body.subject;
    if (req.body.startDateTime !== undefined) (exam as any).startDateTime = req.body.startDateTime;
    if (req.body.endDateTime !== undefined) (exam as any).endDateTime = req.body.endDateTime;
    if (req.body.date !== undefined) (exam as any).date = req.body.date;
    if (req.body.joinCode !== undefined) (exam as any).joinCode = req.body.joinCode;
    if (req.body.accessToken !== undefined) (exam as any).accessToken = req.body.accessToken;
    if (req.body.status !== undefined) {
      (exam as any).status = req.body.status;
      exam.isPublished = req.body.status === 'PUBLISHED';
    }
    if (accessType !== undefined) exam.accessType = accessType;
    if (price !== undefined) {
      exam.price = accessType === 'paid' || exam.accessType === 'paid' ? Number(price) : 0;
    }
    if (durationMinutes !== undefined) exam.durationMinutes = Number(durationMinutes);
    if (totalMarks !== undefined) exam.totalMarks = Number(totalMarks);
    if (passMarks !== undefined) exam.passMarks = Number(passMarks);
    if (questions !== undefined) exam.questions = sanitizeQuestionsList(questions);
    if (isPublished !== undefined) exam.isPublished = Boolean(isPublished);

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

    await Exam.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Exam deleted successfully',
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

    const exam = await Exam.findById(id);
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

    let exam = null;
    if (id.match(/^[0-9a-fA-F]{24}$/)) {
      exam = await Exam.findById(id);
    }
    if (!exam) {
      exam = await Exam.findOne({
        $or: [
          { joinCode: id.toUpperCase() },
          { joinCode: id },
          { accessToken: id }
        ]
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

    // Evaluate answers
    let score = 0;
    const evaluatedAnswers = answers.map((ans: { questionId: string; selectedOptionIndex?: number; submittedAnswer?: any }) => {
      const q = exam.questions.find(
        (quest) => quest.id === ans.questionId || (quest as any)._id?.toString() === ans.questionId
      );
      const selectedIndex = ans.selectedOptionIndex !== undefined ? ans.selectedOptionIndex : Number(ans.submittedAnswer);
      const isCorrect = q ? q.correctOptionIndex === selectedIndex : false;
      const marksObtained = isCorrect ? (q?.marks || 1) : 0;
      score += marksObtained;

      return {
        questionId: ans.questionId,
        selectedOptionIndex: selectedIndex,
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
