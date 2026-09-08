import { Router } from 'express';
import examRoutes from './exam.routes';
import subscriptionRoutes from './subscription.routes';
import questionRoutes from './question.routes';
import adminRoutes from './admin.routes';
import practiceRoutes from './practice.routes';
import paymentRoutes from './payment.routes';
import studentRoutes from './student.routes';

const router = Router();

router.use('/exams', examRoutes);
router.use('/subscriptions', subscriptionRoutes);
router.use('/questions', questionRoutes);
router.use('/admin', adminRoutes);
router.use('/practice', practiceRoutes);
router.use('/payments', paymentRoutes);
router.use('/student', studentRoutes);

export default router;