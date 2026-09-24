import { Router } from 'express';
import { getTeacherExamsSubmissions } from '../controllers/exam.monitoring.controller';
import { requireAuth, requireRole } from '../middlewares/auth.middleware';

const router = Router();

// GET /api/teacher/submissions/all — all submissions across a teacher's exams
router.get(
  '/submissions/all',
  requireAuth,
  requireRole('teacher', 'admin'),
  getTeacherExamsSubmissions
);

export default router;
