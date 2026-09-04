import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import { getStudentDashboardStats } from '../controllers/student.controller';

const router = Router();

router.use(requireAuth);

router.get('/dashboard-stats', getStudentDashboardStats);

export default router;
