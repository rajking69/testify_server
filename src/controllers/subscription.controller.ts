import { Request, Response } from 'express';
import { SubscriptionPlan } from '../models/subscription-plan.model';
import { UserSubscription } from '../models/subscription.model';

// Seed default plans if collection is empty
const seedDefaultPlans = async () => {
  const count = await SubscriptionPlan.countDocuments();
  if (count === 0) {
    await SubscriptionPlan.create([
      {
        name: 'Teacher Monthly Pro',
        targetRole: 'teacher',
        interval: 'monthly',
        price: 499, // e.g. ৳499 / $9.99
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
        price: 4999, // 2 months free
        durationDays: 365,
        features: [
          'All Monthly Pro Features',
          'Priority Teacher Support',
          'Custom Exam Branding',
          'Bulk Student Invite & Export',
        ],
        isActive: true,
      },
      {
        name: 'Student Monthly All-Access',
        targetRole: 'student',
        interval: 'monthly',
        price: 199,
        durationDays: 30,
        features: [
          'Unlimited Access to All Special & Premium Exams',
          'Detailed Performance Reports',
          'Leaderboard Ranking',
        ],
        isActive: true,
      },
      {
        name: 'Student Yearly All-Access',
        targetRole: 'student',
        interval: 'yearly',
        price: 1899,
        durationDays: 365,
        features: [
          'All Student Monthly Features',
          'Full Year Unlimited Exam Access',
          'Certificate of Completion',
        ],
        isActive: true,
      },
    ]);
  }
};

// 1. GET /api/subscriptions/plans - Get all available plans
export const getSubscriptionPlans = async (req: Request, res: Response): Promise<void> => {
  try {
    await seedDefaultPlans();

    const { role } = req.query;
    const filter: any = { isActive: true };
    if (role) filter.targetRole = role;

    const plans = await SubscriptionPlan.find(filter).sort({ price: 1 });

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

    const activeSubscription = await UserSubscription.findOne({
      userId: user.id,
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

// 3. POST /api/subscriptions/subscribe - Subscribe to a plan
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

    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);

    // Expire any existing active subscriptions for this user
    await UserSubscription.updateMany(
      { userId: user.id, status: 'active' },
      { status: 'expired' }
    );

    // Create new active subscription
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
