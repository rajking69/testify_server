import { Request, Response, NextFunction } from 'express';
import User from '../models/user.model';
import { UserSubscription } from '../models/subscription.model';
import { Exam } from '../models/exam.model';
import { ExamPurchase } from '../models/exam-purchase.model';

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

    if (!isUserPremium && !activeSubscription) {
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
      message: 'Failed to verify subscription status.',
    });
  }
};

// Middleware to check if student has access to an exam (Free vs Paid vs Subscribed)
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

    const exam = await Exam.findById(id);
    if (!exam) {
      res.status(404).json({
        success: false,
        message: 'Exam not found.',
      });
      return;
    }

    // Admin or Exam Creator Teacher has full access
    if (user.role === 'admin' || (user.role === 'teacher' && exam.teacherId === user.id)) {
      return next();
    }

    // Free Exam: Any logged-in student has access
    if (exam.accessType === 'free') {
      return next();
    }

    // Check if Student has active subscription (all-access)
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

    // If no all-access subscription, check if student made a direct one-time purchase
    if (exam.accessType === 'paid') {
      const purchase = await ExamPurchase.findOne({
        studentId: user.id,
        examId: exam._id,
        status: 'completed',
      });

      if (purchase) {
        return next();
      }
    }

    // If neither active subscription nor purchase found
    res.status(403).json({
      success: false,
      code: 'PURCHASE_OR_SUBSCRIPTION_REQUIRED',
      message:
        'This is a special premium exam. Please purchase this exam or subscribe to a Student plan to participate.',
      price: exam.price,
      accessType: exam.accessType,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to verify exam access permission.',
    });
  }
};
