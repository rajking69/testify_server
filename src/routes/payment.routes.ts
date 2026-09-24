import { Router } from 'express';
import { requireAuth, requireRole } from '../middlewares/auth.middleware';
import {
  createTeacherPremiumCheckout,
  getTeacherPremiumStatus,
} from '../controllers/payment.checkout.controller';
import {
  handleStripeWebhook,
} from '../controllers/payment.webhook.controller';
import {
  getTeacherRevenue,
} from '../controllers/payment.revenue.controller';
import {
  getCheckoutSessionDetails,
} from '../controllers/payment.session.controller';

const router = Router();

// 1. Teacher Premium Stripe Checkout
router.post(
  ['/teacher/premium/checkout', '/teacher-premium/checkout'],
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

// 4. Session details
router.get('/session/:sessionId', getCheckoutSessionDetails);

// 5. Teacher Revenue & Sales Analytics Endpoint
router.get(
  '/teacher/revenue',
  requireAuth,
  requireRole('teacher', 'admin'),
  getTeacherRevenue
);

export default router;