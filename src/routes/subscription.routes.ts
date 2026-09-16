import { Router } from 'express';
import {
  getSubscriptionPlans,
  getMySubscription,
  subscribePlan,
  getAllPlansAdmin,
  createPlanAdmin,
  updatePlanAdmin,
  deletePlanAdmin,
  getSubscriptionAdminOverview,
} from '../controllers/subscription.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

// Publicly viewable plans (Monthly & Yearly for Teachers & Students)
router.get('/plans', getSubscriptionPlans);

// User Subscription Management
router.get('/my-status', requireAuth, getMySubscription);
router.post('/subscribe', requireAuth, subscribePlan);

// Admin Subscription & Plan Management Routes
router.get('/admin/all-plans', getAllPlansAdmin);
router.post('/admin/plans', createPlanAdmin);
router.put('/admin/plans/:id', updatePlanAdmin);
router.delete('/admin/plans/:id', deletePlanAdmin);
router.get('/admin/overview', getSubscriptionAdminOverview);

export default router;
