import mongoose from 'mongoose';
import { Request, Response, NextFunction } from 'express';
import User from '../models/user.model';
import { UserSubscription } from '../models/subscription.model';
import { Exam } from '../models/exam.model';
import { ExamPurchase } from '../models/exam-purchase.model';
import { ExamSubmission } from '../models/exam-submission.model';

// Middleware to verify Teacher has an active subscription to create/host exams
export const requireTeacherSubscription = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({
        success: false,
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
      });
      return;
    }

    // Admin bypass
    if (user.role === 'admin') {
      return next();
    }

    if (user.role !== 'teacher') {
      res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: 'Only teachers can create and manage exams.',
      });
      return;
    }

    // Check active premium status or subscription for teacher
    const now = new Date();
    const dbUser = await User.findById(user.id);
    const isUserPremium = Boolean(
      dbUser?.isPremium && dbUser.premiumExpiresAt && dbUser.premiumExpiresAt > now
    );

    const activeSubscription = await UserSubscription.findOne({
      userId: user.id,
      role: 'teacher',
      status: 'active',
      endDate: { $gt: now },
    });

    // Allow exam creation in non-production environments for development and testing
    const isDev = process.env.NODE_ENV !== 'production';
    if (!isDev && !isUserPremium && !activeSubscription) {
      res.status(403).json({
        success: false,
        code: 'SUBSCRIPTION_REQUIRED',
        message:
          'Active Teacher Premium subscription required to create or host exams. Please upgrade to Teacher Premium ($20/year).',
      });
      return;
    }

    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Failed to verify subscription status.',
    });
  }
};

// Middleware to check if student has access to attempt an exam (Free vs Paid vs Subscribed)
export const requireExamAccess = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = req.user;
    const { id } = req.params;

    if (!user) {
      res.status(401).json({
        success: false,
        code: 'UNAUTHORIZED',
        message: 'Authentication required to start or access exam.',
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
        message: 'Exam not found.',
      });
      return;
    }

    (req as any).exam = exam;

    // Rule 1: Teachers cannot attempt exams under any circumstances
    if (user.role === 'teacher') {
      res.status(403).json({
        success: false,
        code: 'TEACHER_ATTEMPT_FORBIDDEN',
        message: 'Teacher accounts are strictly forbidden from attempting examinations. Teachers can only create, manage, and preview their own exams.',
      });
      return;
    }

    // Rule 2: Single attempt per student account (Strict backend enforcement)
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

    // Admin bypass for remaining checks (e.g. testing free/paid access)
    if (user.role === 'admin') {
      return next();
    }

    // Rule 3: Free Exam - Any logged-in student has access
    if (exam.accessType === 'free' && (!exam.price || exam.price <= 0)) {
      return next();
    }

    // Rule 4: Paid Exam - Check active all-access student subscription
    const now = new Date();
    const activeStudentSubscription = await UserSubscription.findOne({
      userId: user.id,
      role: 'student',
      status: 'active',
      endDate: { $gt: now },
    });

    if (activeStudentSubscription) {
      return next();
    }

    // Rule 5: Check one-time purchase
    const purchase = await ExamPurchase.findOne({
      studentId: user.id,
      examId: exam._id,
      status: 'completed',
    });

    if (purchase) {
      return next();
    }

    // If neither active subscription nor valid purchase found
    res.status(403).json({
      success: false,
      code: 'PURCHASE_REQUIRED',
      message:
        'This is a paid examination. Please purchase this exam or subscribe to a Student plan to participate.',
      price: exam.price,
      accessType: exam.accessType,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Failed to verify exam access permission.',
    });
  }
};
