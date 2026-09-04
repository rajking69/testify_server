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
router.post('/:id/start', requireAuth, requireExamAccess, (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Exam access verified. You can now begin.',
  });
});
router.post('/:id/submit', requireAuth, requireExamAccess, submitExam);

export default router;
