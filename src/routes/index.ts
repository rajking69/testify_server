import { Router } from 'express';
import examRoutes from './exam.routes';
import subscriptionRoutes from './subscription.routes';

const router = Router();

router.use('/exams', examRoutes);
router.use('/subscriptions', subscriptionRoutes);

export default router;
