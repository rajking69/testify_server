import { Router } from 'express';
import examRoutes from './exam.routes';
import subscriptionRoutes from './subscription.routes';
import questionRoutes from './question.routes';

const router = Router();

router.use('/exams', examRoutes);
router.use('/subscriptions', subscriptionRoutes);
router.use('/questions', questionRoutes);

export default router;