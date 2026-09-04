import { Router } from 'express';
import { requireAuth, requireRole } from '../middlewares/auth.middleware';
import {
  createTeacherPremiumCheckout,
  getTeacherPremiumStatus,
  handleStripeWebhook,
} from '../controllers/payment.controller';

const router = Router();

// 1. Teacher Premium Stripe Checkout
router.post(
  '/teacher/premium/checkout',
  requireAuth,
  requireRole('teacher', 'admin'),
  createTeacherPremiumCheckout
);

// 2. Teacher Premium Status Check
router.get(
  '/teacher/premium/status',
  requireAuth,
  getTeacherPremiumStatus
);

// 3. Stripe Webhook
router.post('/stripe/webhook', handleStripeWebhook);

export default router;
