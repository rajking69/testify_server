import { Request, Response } from 'express';
import { Exam } from '../models/exam.model';
import { ExamPurchase } from '../models/exam-purchase.model';
import User from '../models/user.model';
import { UserSubscription } from '../models/subscription.model';
import { SubscriptionPlan } from '../models/subscription-plan.model';
import { PaymentEvent } from '../models/payment-event.model';
import {
  createTeacherPremiumCheckoutSession,
  constructStripeEvent,
  stripe,
} from '../lib/stripe';
import { logger } from '../lib/logger';

export const createTeacherPremiumCheckout = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({
        success: false,
        code: 'UNAUTHORIZED',
        message: 'Authentication required to access checkout.',
      });
      return;
    }

    if (user.role !== 'teacher' && user.role !== 'admin') {
      res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: 'Only teachers can upgrade to Teacher Premium.',
      });
      return;
    }

    const userEmailNorm = (user.email || '').toLowerCase().trim();
    const now = new Date();

    const dbUser = await User.findOne({
      $or: [
        { _id: user.id },
        { email: userEmailNorm },
        { email: user.email },
      ],
    });

    const activeSubscription = await UserSubscription.findOne({
      $or: [
        { userId: user.id },
        { userEmail: userEmailNorm },
        { userEmail: user.email },
      ],
      role: 'teacher',
      status: 'active',
      endDate: { $gt: now },
    }).sort({ endDate: -1 });

    const isAlreadySubscribed = Boolean(
      (dbUser?.isPremium && dbUser.premiumExpiresAt && dbUser.premiumExpiresAt > now) ||
        activeSubscription
    );

    if (isAlreadySubscribed) {
      const activeExpiry = dbUser?.premiumExpiresAt || activeSubscription?.endDate;
      const expiryFormatted = activeExpiry
        ? new Date(activeExpiry).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : 'current active period';

      res.status(400).json({
        success: false,
        code: 'ALREADY_SUBSCRIBED',
        message: `Subscription already active! Your current plan is valid until ${expiryFormatted}. You cannot renew or purchase a new subscription until it expires.`,
        expiresAt: activeExpiry,
      });
      return;
    }

    const { planId, interval, billingInterval, priceAmount, planName, successUrl, cancelUrl } = req.body || {};

    let selectedPlan = null;
    if (planId) {
      selectedPlan = await SubscriptionPlan.findById(planId);
    }

    const rawInterval = (interval || billingInterval || selectedPlan?.interval || 'monthly').toString().toLowerCase();
    const isYearly = rawInterval.includes('year') || rawInterval === 'yearly' || rawInterval === 'annual';
    const stripeInterval: 'month' | 'year' = isYearly ? 'year' : 'month';

    if (!selectedPlan) {
      selectedPlan = await SubscriptionPlan.findOne({
        targetRole: 'teacher',
        interval: isYearly ? 'yearly' : 'monthly',
      });
    }

    const finalPrice: number = typeof priceAmount === 'number' && priceAmount > 0
      ? priceAmount
      : selectedPlan?.price && selectedPlan.price > 0
        ? selectedPlan.price
        : isYearly ? 199.99 : 19.99;

    const finalPlanName: string = planName
      ? planName
      : selectedPlan?.name
        ? selectedPlan.name
        : isYearly ? 'Teacher Elite (Yearly Plan)' : 'Teacher Pro (Monthly Plan)';

    const session = await createTeacherPremiumCheckoutSession({
      teacherId: user.id,
      teacherEmail: user.email,
      teacherName: user.name,
      priceAmount: finalPrice,
      interval: stripeInterval,
      planName: finalPlanName,
      planId: selectedPlan?._id?.toString() || planId,
      successUrl,
      cancelUrl,
    });

    logger.info({ teacherId: user.id, sessionId: session.id, planName: finalPlanName, price: finalPrice, interval: stripeInterval }, 'Stripe checkout session created');
    res.status(200).json({
      success: true,
      sessionId: session.id,
      url: session.url,
      planName: finalPlanName,
      price: finalPrice,
      interval: stripeInterval,
    });
  } catch (error) {
    logger.error({ error, teacherId: req.user?.id }, 'Stripe checkout error');
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : String(error) || 'Failed to initialize Stripe checkout session',
    });
  }
};

export const getTeacherPremiumStatus = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({
        success: false,
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
      });
      return;
    }

    const userEmailNorm = (user.email || '').toLowerCase().trim();
    const now = new Date();

    const dbUser = await User.findOne({
      $or: [
        { _id: user.id },
        { email: userEmailNorm },
        { email: user.email },
      ],
    });

    const activeSubscription = await UserSubscription.findOne({
      $or: [
        { userId: user.id },
        { userEmail: userEmailNorm },
        { userEmail: user.email },
        { userEmail: { $regex: new RegExp(`^${userEmailNorm.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}$`, 'i') } },
      ],
      status: 'active',
      endDate: { $gt: now },
    }).sort({ endDate: -1 });

    const isPremiumActive = Boolean(
      (dbUser?.isPremium && dbUser.premiumExpiresAt && dbUser.premiumExpiresAt > now) ||
        activeSubscription ||
        user.role === 'admin'
    );

    if (activeSubscription && dbUser && (!dbUser.isPremium || !dbUser.premiumExpiresAt || dbUser.premiumExpiresAt < activeSubscription.endDate)) {
      await User.findByIdAndUpdate(dbUser._id, {
        isPremium: true,
        premiumStatus: 'active',
        premiumExpiresAt: activeSubscription.endDate,
      });
    }

    const expiryDate = dbUser?.premiumExpiresAt || activeSubscription?.endDate || null;
    const planName = activeSubscription?.planName || (user.role === 'admin' ? 'Administrator Unlimited Access' : 'Testify Teacher Pro Plan');
    const pricePaid = activeSubscription?.pricePaid || 19.99;

    logger.info({ teacherId: user.id, isPremium: isPremiumActive }, 'Teacher premium status fetched');
    res.status(200).json({
      success: true,
      data: {
        isPremium: isPremiumActive,
        premiumStatus: isPremiumActive
          ? 'active'
          : dbUser?.premiumStatus || 'none',
        premiumExpiresAt: expiryDate,
        stripeCustomerId: dbUser?.stripeCustomerId || null,
        stripeSubscriptionId: dbUser?.stripeSubscriptionId || null,
        planName,
        price: pricePaid,
        interval: activeSubscription?.interval || 'monthly',
        currency: 'USD',
      },
    });
  } catch (error) {
    logger.error({ error, teacherId: req.user?.id }, 'Failed to fetch teacher premium status');
    res.status(500).json({
      success: false,
      message: 'Failed to fetch Teacher Premium status',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};