import { Router } from 'express';
import {
  getPublicExams,
  getAllExams,
  getExamById,
  createExam,
  purchaseExam,
  submitExam,
  getMySubmissions,
} from '../controllers/exam.controller';
import { requireAuth, optionalAuth, requireRole } from '../middlewares/auth.middleware';
import {
  requireTeacherSubscription,
  requireExamAccess,
} from '../middlewares/subscription.middleware';

import { ExamSubmission } from '../models/exam-submission.model';

const router = Router();

// Public route: Only shows free exams, no login required
router.get('/public', getPublicExams);

// Authenticated / Optional routes
router.get('/', optionalAuth, getAllExams);
router.get('/my/submissions', requireAuth, getMySubmissions);
router.get('/:id', optionalAuth, getExamById);

// Teacher Exam Creation (Requires Teacher Role + Active Subscription)
router.post('/', requireAuth, requireRole('teacher', 'admin'), requireTeacherSubscription, createExam);

// Student Exam Purchase (One-time payment for paid/special exams)
router.post('/:id/purchase', requireAuth, purchaseExam);

// Student Exam Start & Submit (Requires Login + Free / Subscription / Purchase verification)
router.post('/:id/start', requireAuth, requireExamAccess, async (req, res): Promise<void> => {
  const user = req.user!;
  const existing = await ExamSubmission.findOne({
    examId: req.params.id,
    $or: [{ studentId: user.id }, { studentEmail: user.email }],
  });

  if (existing) {
    res.status(403).json({
      success: false,
      code: 'ALREADY_COMPLETED',
      message: 'You have already attempted this examination. Only one attempt is permitted per account.',
    });
    return;
  }

  res.status(200).json({
    success: true,
    message: 'Exam access verified. You can now begin.',
  });
});
router.post('/:id/submit', requireAuth, requireExamAccess, submitExam);

export default router;
