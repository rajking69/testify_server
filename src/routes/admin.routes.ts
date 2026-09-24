import { Router } from 'express';
import { requireAuth, requireRole } from '../middlewares/auth.middleware';
import {
  getDashboardOverview,
  getAllUsers,
  updateUser,
  deleteUser,
} from '../controllers/admin.users.controller';
import {
  getAnalyticsOverview,
} from '../controllers/admin.analytics.controller';
import {
  getPayments,
  getFeatureFlags,
  toggleFeatureFlag,
  createFeatureFlag,
  updateFeatureFlag,
  deleteFeatureFlag,
  getSystemConfigs,
  updateSystemConfig,
} from '../controllers/admin.settings.controller';

const router = Router();

// Protect all admin routes with auth and admin role requirement
router.use(requireAuth);
router.use(requireRole('admin'));

router.get('/dashboard', getDashboardOverview);
router.get('/analytics', getAnalyticsOverview);
router.get('/users', getAllUsers);
router.patch('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);
router.get('/payments', getPayments);
router.get('/features', getFeatureFlags);
router.post('/features', createFeatureFlag);
router.patch('/features/:id/toggle', toggleFeatureFlag);
router.put('/features/:id', updateFeatureFlag);
router.delete('/features/:id', deleteFeatureFlag);
router.get('/settings', getSystemConfigs);
router.patch('/settings/:key', updateSystemConfig);

export default router;