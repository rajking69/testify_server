import { Router } from 'express';
import { requireAuth, requireRole } from '../middlewares/auth.middleware';
import {
  createTeacherPremiumCheckout,
  getTeacherPremiumStatus,
  getTeacherRevenue,
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


// 4. Teacher Revenue & Sales Analytics Endpoint
router.get(
  '/teacher/revenue',
  requireAuth,
  requireRole('teacher', 'admin'),
  getTeacherRevenue
);

export default router;
