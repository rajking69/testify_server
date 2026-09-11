import { Router } from 'express';
import {
  getSubscriptionPlans,
  getMySubscription,
  subscribePlan,
} from '../controllers/subscription.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

// Publicly viewable plans (Monthly & Yearly for Teachers & Students)
router.get('/plans', getSubscriptionPlans);

// User Subscription Management
router.get('/my-status', requireAuth, getMySubscription);
router.post('/subscribe', requireAuth, subscribePlan);

export default router;
