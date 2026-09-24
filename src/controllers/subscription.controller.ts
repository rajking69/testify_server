import { Request, Response } from 'express';
import User from '../models/user.model';
import { SubscriptionPlan } from '../models/subscription-plan.model';
import { UserSubscription } from '../models/subscription.model';
import { getOrSetCache, CacheKeys, CacheTTL, invalidateCachePattern } from '../lib/cache';

// Seed default plans if collection is empty
const seedDefaultPlans = async () => {
  const count = await SubscriptionPlan.countDocuments({ targetRole: 'teacher' });
  if (count === 0) {
    await SubscriptionPlan.create([
      {
        name: 'Teacher Monthly Pro',
        targetRole: 'teacher',
        interval: 'monthly',
        price: 19.99,
        durationDays: 30,
        features: [
          'Create & Host Unlimited Exams',
          'Access to Question Bank',
          'Detailed Student Analytics',
          'Instant Result Publishing',
        ],
        isActive: true,
      },
      {
        name: 'Teacher Yearly Elite',
        targetRole: 'teacher',
        interval: 'yearly',
        price: 199.99,
        durationDays: 365,
        features: [
          'All Monthly Pro Features',
          'Priority Teacher Support',
          'Custom Exam Branding',
          'Bulk Student Invite & Export',
        ],
        isActive: true,
      },
    ]);
  };
};

// 1. GET /api/subscriptions/plans - Get all available plans
export const getSubscriptionPlans = async (req: Request, res: Response): Promise<void> => {
  try {
    await seedDefaultPlans();

    const { role } = req.query;
    const filter: any = { isActive: true };
    if (role) filter.targetRole = role;

    const cacheKey = role ? CacheKeys.PLANS_BY_ROLE(role as string) : CacheKeys.PLANS;
    const plans = await getOrSetCache(cacheKey, async () => {
      return SubscriptionPlan.find(filter).sort({ price: 1 }).lean();
    }, { ttl: CacheTTL.LONG });

    res.status(200).json({
      success: true,
      count: plans.length,
      data: plans,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch subscription plans',
      error: error instanceof Error ? error.message : error,
    });
  }
};

// 2. GET /api/subscriptions/my-status - Get current user subscription status
export const getMySubscription = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const now = new Date();
    const userEmailNorm = (user.email || '').toLowerCase().trim();

    const activeSubscription = await UserSubscription.findOne({
      $or: [
        { userId: user.id },
        { userEmail: userEmailNorm },
        { userEmail: user.email },
      ],
      status: 'active',
      endDate: { $gt: now },
    }).populate('planId');

    res.status(200).json({
      success: true,
      hasActiveSubscription: !!activeSubscription,
      data: activeSubscription || null,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch subscription status',
      error: error instanceof Error ? error.message : error,
    });
  }
};

// 3. POST /api/subscriptions/subscribe - Subscribe to a plan (with strict active sub check)
export const subscribePlan = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { planId } = req.body;

    if (!planId) {
      res.status(400).json({ success: false, message: 'planId is required' });
      return;
    }

    const plan = await SubscriptionPlan.findById(planId);
    if (!plan || !plan.isActive) {
      res.status(404).json({ success: false, message: 'Subscription plan not found or inactive' });
      return;
    }

    const now = new Date();
    const userEmailNorm = (user.email || '').toLowerCase().trim();
    const activeSub = await UserSubscription.findOne({
      $or: [
        { userId: user.id },
        { userEmail: userEmailNorm },
        { userEmail: user.email },
      ],
      status: 'active',
      endDate: { $gt: now },
    });

    if (activeSub) {
      const expiryFormatted = new Date(activeSub.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      res.status(400).json({
        success: false,
        code: 'ALREADY_SUBSCRIBED',
        message: `Subscription already active! Your current plan is valid until ${expiryFormatted}. You cannot renew or purchase a new subscription until it expires.`,
      });
      return;
    }

    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);

    const newSubscription = await UserSubscription.create({
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
      role: plan.targetRole,
      planId: plan._id,
      planName: plan.name,
      interval: plan.interval,
      pricePaid: plan.price,
      startDate,
      endDate,
      status: 'active',
      paymentId: `SUB-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    });

    // Sync User model for instant permission resolution
    await User.findByIdAndUpdate(user.id, {
      isPremium: true,
      premiumStatus: 'active',
      premiumExpiresAt: endDate,
    });

    res.status(200).json({
      success: true,
      message: `Successfully subscribed to ${plan.name}!`,
      data: newSubscription,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to create subscription',
      error: error instanceof Error ? error.message : error,
    });
  }
};

// --- ADMIN SUBSCRIPTION PLAN MANAGEMENT ---

// 4. GET /api/subscriptions/admin/all-plans - Admin list all plans (active & inactive)
export const getAllPlansAdmin = async (req: Request, res: Response): Promise<void> => {
  try {
    await seedDefaultPlans();
    const plans = await SubscriptionPlan.find().sort({ targetRole: 1, price: 1 });
    res.status(200).json({ success: true, count: plans.length, data: plans });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch admin subscription plans', error });
  }
};

// 5. POST /api/subscriptions/admin/plans - Create a new plan
export const createPlanAdmin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, targetRole, interval, price, durationDays, features, isActive } = req.body;

    if (!name || !targetRole || !interval || price === undefined) {
      res.status(400).json({ success: false, message: 'name, targetRole, interval, and price are required' });
      return;
    }

    const newPlan = await SubscriptionPlan.create({
      name,
      targetRole,
      interval,
      price: Number(price),
      durationDays: durationDays ? Number(durationDays) : (interval === 'yearly' ? 365 : 30),
      features: Array.isArray(features) ? features : (features ? String(features).split(',').map(s => s.trim()) : []),
      isActive: isActive !== undefined ? Boolean(isActive) : true,
    });

    // Invalidate plans cache
    await invalidateCachePattern('plans*');

    res.status(201).json({ success: true, message: 'Subscription plan created successfully', data: newPlan });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to create plan', error: error instanceof Error ? error.message : error });
  }
};

// 6. PUT /api/subscriptions/admin/plans/:id - Update an existing plan
export const updatePlanAdmin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, targetRole, interval, price, durationDays, features, isActive } = req.body;

    const updateFields: any = {};
    if (name !== undefined) updateFields.name = name;
    if (targetRole !== undefined) updateFields.targetRole = targetRole;
    if (interval !== undefined) updateFields.interval = interval;
    if (price !== undefined) updateFields.price = Number(price);
    if (durationDays !== undefined) updateFields.durationDays = Number(durationDays);
    if (features !== undefined) {
      updateFields.features = Array.isArray(features) ? features : String(features).split(',').map(s => s.trim());
    }
    if (isActive !== undefined) updateFields.isActive = Boolean(isActive);

    const updatedPlan = await SubscriptionPlan.findByIdAndUpdate(id, updateFields, { new: true });
    if (!updatedPlan) {
      res.status(404).json({ success: false, message: 'Subscription plan not found' });
      return;
    }

    // Invalidate plans cache
    await invalidateCachePattern('plans*');

    res.status(200).json({ success: true, message: 'Subscription plan updated successfully', data: updatedPlan });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update plan', error: error instanceof Error ? error.message : error });
  }
};

// 7. DELETE /api/subscriptions/admin/plans/:id - Delete a plan
export const deletePlanAdmin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const plan = await SubscriptionPlan.findByIdAndDelete(id);
    if (!plan) {
      res.status(404).json({ success: false, message: 'Subscription plan not found' });
      return;
    }

    // Invalidate plans cache
    await invalidateCachePattern('plans*');

    res.status(200).json({ success: true, message: 'Subscription plan deleted successfully', data: { id } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete plan', error: error instanceof Error ? error.message : error });
  }
};

// 8. GET /api/subscriptions/admin/overview - Detailed user subscription analytics & active list
export const getSubscriptionAdminOverview = async (req: Request, res: Response): Promise<void> => {
  try {
    const [totalSubscribers, activeSubscriptions, plans, allUserSubscriptions] = await Promise.all([
      UserSubscription.countDocuments(),
      UserSubscription.find({ status: 'active' }).sort({ createdAt: -1 }),
      SubscriptionPlan.find(),
      UserSubscription.find().sort({ createdAt: -1 }),
    ]);

    const activeCount = activeSubscriptions.length;
    const monthlyRevenue = activeSubscriptions.reduce((acc, sub) => acc + (sub.pricePaid || 0), 0);

    const proCount = activeSubscriptions.filter(s => s.planName?.toLowerCase().includes('pro') || s.role === 'teacher').length;
    const freeCount = Math.max(0, totalSubscribers - activeCount);
    const institutionalCount = activeSubscriptions.filter(s => s.planName?.toLowerCase().includes('institutional') || s.planName?.toLowerCase().includes('elite')).length;

    res.status(200).json({
      success: true,
      stats: {
        total: totalSubscribers || allUserSubscriptions.length,
        active: activeCount,
        pro: proCount,
        free: freeCount,
        institutional: institutionalCount,
        monthlyRevenue,
        activePlansCount: plans.filter(p => p.isActive).length,
      },
      plans,
      subscriptions: allUserSubscriptions,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch admin subscription overview', error });
  }
};
