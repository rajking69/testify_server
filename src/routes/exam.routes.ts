import { Router } from 'express';
import {
  getPublicExams,
  getAllExams,
  getExamById,
  createExam,
  updateExam,
  deleteExam,
  purchaseExam,
  submitExam,
  getMySubmissions,
  getMyPurchases,
} from '../controllers/exam.controller';
import { requireAuth, optionalAuth, requireRole } from '../middlewares/auth.middleware';
import {
  requireTeacherSubscription,
  requireExamAccess,
} from '../middlewares/subscription.middleware';

const router = Router();

// Public route: Shows all published exams (free and paid), sanitized questions
router.get('/public', getPublicExams);

// Authenticated / Optional routes
router.get('/', optionalAuth, getAllExams);
router.get('/my/submissions', requireAuth, getMySubmissions);
router.get('/my/purchases', requireAuth, getMyPurchases);
router.get('/:id', optionalAuth, getExamById);

// Teacher Exam Creation (Requires Teacher Role + Active Subscription)
router.post('/', requireAuth, requireRole('teacher', 'admin'), requireTeacherSubscription, createExam);

// Teacher Exam Update & Delete (Enforces Teacher Ownership or Admin)
router.patch('/:id', requireAuth, requireRole('teacher', 'admin'), updateExam);
router.delete('/:id', requireAuth, requireRole('teacher', 'admin'), deleteExam);

// Student Exam Purchase (One-time payment for paid/special exams; forbidden for teachers)
router.post('/:id/purchase', requireAuth, purchaseExam);

// Student Exam Start & Submit (Enforces Student role, 1 attempt limit, and purchase/subscription check)
router.post('/:id/start', requireAuth, requireExamAccess, async (req, res): Promise<void> => {
  res.status(200).json({
    success: true,
    message: 'Exam access verified. You can now begin.',
  });
});
router.post('/:id/submit', requireAuth, requireExamAccess, submitExam);

export default router;
