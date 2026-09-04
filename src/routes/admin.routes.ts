import { Router } from 'express';
import { requireAuth, requireRole } from '../middlewares/auth.middleware';
import {
  getDashboardOverview,
  getAllUsers,
  updateUser,
  getPayments,
  getFeatureFlags,
  toggleFeatureFlag,
  getSystemConfigs,
  updateSystemConfig,
} from '../controllers/admin.controller';

const router = Router();

// Protect all admin routes with auth and admin role requirement
router.use(requireAuth);
router.use(requireRole('admin'));

router.get('/dashboard', getDashboardOverview);
router.get('/users', getAllUsers);
router.patch('/users/:id', updateUser);
router.get('/payments', getPayments);
router.get('/features', getFeatureFlags);
router.patch('/features/:id/toggle', toggleFeatureFlag);
router.get('/settings', getSystemConfigs);
router.patch('/settings/:key', updateSystemConfig);

export default router;
