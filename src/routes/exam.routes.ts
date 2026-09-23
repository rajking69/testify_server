import { Router } from 'express';
import {
  getPublicExams,
  getAllExams,
  getExamById,
} from '../controllers/exam.public.controller';
import {
  createExam,
  updateExam,
  deleteExam,
} from '../controllers/exam.management.controller';
import {
  purchaseExam,
  submitExam,
  startExamAttempt,
  sendExamHeartbeat,
  getMySubmissions,
  getMyPurchases,
} from '../controllers/exam.student.controller';
import {
  getLiveMonitoringData,
  getTeacherExamsSubmissions,
} from '../controllers/exam.monitoring.controller';
import {
  getSubmissionTranscript,
} from '../controllers/exam.transcript.controller';
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

// Teacher & Admin Exam Management
router.post('/', requireAuth, requireRole('teacher', 'admin'), requireTeacherSubscription, createExam);
router.patch('/:id', requireAuth, requireRole('teacher', 'admin'), updateExam);
router.delete('/:id', requireAuth, requireRole('teacher', 'admin'), deleteExam);

// Student Exam Purchase (One-time payment for paid/special exams; forbidden for teachers)
router.post('/:id/purchase', requireAuth, purchaseExam);

// Student Exam Start & Submit (Enforces Student role, 1 attempt limit, and purchase/subscription check via requireExamAccess)
router.post('/:id/start', requireAuth, requireExamAccess, async (req, res): Promise<void> => {
  res.status(200).json({
    success: true,
    message: 'Exam access verified. You can now begin.',
  });
});
router.post('/:id/submit', requireAuth, requireExamAccess, submitExam);

router.post('/:id/start-attempt', requireAuth, startExamAttempt);
router.post('/:id/heartbeat', requireAuth, sendExamHeartbeat);
router.get('/teacher/live-monitoring/:examId', requireAuth, requireRole('teacher', 'admin'), getLiveMonitoringData);
router.get('/submissions/:id/transcript', requireAuth, getSubmissionTranscript);

router.get('/teacher/submissions/all', requireAuth, requireRole('teacher', 'admin'), getTeacherExamsSubmissions);

export default router;