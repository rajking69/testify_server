import { Exam } from '../models/exam.model';
import { ExamPurchase } from '../models/exam-purchase.model';
import { Request, Response } from 'express';
import User from '../models/user.model';
import { UserSubscription } from '../models/subscription.model';
import { SubscriptionPlan } from '../models/subscription-plan.model';
import { PaymentEvent } from '../models/payment-event.model';
import {
  createTeacherPremiumCheckoutSession,
  constructStripeEvent,
  stripe,
} from '../lib/stripe';

/**
 * 1. POST /api/payments/teacher/premium/checkout
 * Creates a Stripe Checkout Session for Teacher Premium ($20/year subscription).
 */
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

    const { successUrl, cancelUrl } = req.body || {};

    const session = await createTeacherPremiumCheckoutSession({
      teacherId: user.id,
      teacherEmail: user.email,
      teacherName: user.name,
      successUrl,
      cancelUrl,
    });

    console.log(`Created Stripe Checkout Session ${session.id} for teacher ${user.email}`);

    res.status(200).json({
      success: true,
      sessionId: session.id,
      url: session.url,
    });
  } catch (error: unknown) {
    console.error('Stripe Checkout Error:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : String(error) || 'Failed to initialize Stripe checkout session',
    });
  }
};

/**
 * 2. GET /api/payments/teacher/premium/status
 * Fetches verified Teacher Premium status from the database.
 */
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

    const dbUser = await User.findById(user.id);
    const now = new Date();

    const activeSubscription = await UserSubscription.findOne({
      userId: user.id,
      role: 'teacher',
      status: 'active',
      endDate: { $gt: now },
    }).sort({ endDate: -1 });

    const isPremiumActive = Boolean(
      (dbUser?.isPremium && dbUser.premiumExpiresAt && dbUser.premiumExpiresAt > now) ||
        activeSubscription ||
        user.role === 'admin'
    );

    res.status(200).json({
      success: true,
      data: {
        isPremium: isPremiumActive,
        premiumStatus: isPremiumActive
          ? 'active'
          : dbUser?.premiumStatus || 'none',
        premiumExpiresAt:
          dbUser?.premiumExpiresAt || activeSubscription?.endDate || null,
        stripeCustomerId: dbUser?.stripeCustomerId || null,
        stripeSubscriptionId: dbUser?.stripeSubscriptionId || null,
        planName: 'Testify Teacher Premium (1 Year)',
        price: 20,
        currency: 'USD',
      },
    });
  } catch (error: unknown) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch Teacher Premium status',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * 3. POST /api/payments/stripe/webhook
 * Handles incoming verified Stripe webhook events idempotently.
 */
export const handleStripeWebhook = async (
  req: Request,
  res: Response
): Promise<void> => {
  const sig = req.headers['stripe-signature'];
  const rawBody = (req as any).rawBody || req.body;

  let event;
  try {
    event = constructStripeEvent(rawBody, sig);
  } catch (err: any) {
    console.error('⚠️ Stripe Webhook signature verification failed:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  // Idempotency check: Ignore duplicate events
  const existingEvent = await PaymentEvent.findOne({ eventId: event.id });
  if (existingEvent) {
    console.log(`Stripe event ${event.id} already processed. Skipping.`);
    res.status(200).json({ received: true, alreadyProcessed: true });
    return;
  }

  console.log(`Processing Stripe Webhook Event: ${event.type} (${event.id})`);

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as any;
        const teacherId =
          session.client_reference_id ||
          session.metadata?.teacherId ||
          session.subscription_data?.metadata?.teacherId;

        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string;
        const teacherEmail = session.customer_email || session.metadata?.teacherEmail;
        const teacherName = session.metadata?.teacherName;

        if (teacherId) {
          const oneYearExpiry = new Date();
          oneYearExpiry.setFullYear(oneYearExpiry.getFullYear() + 1);

          // 1. Update User Record
          await User.findByIdAndUpdate(teacherId, {
            isPremium: true,
            premiumStatus: 'active',
            premiumExpiresAt: oneYearExpiry,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
          });

          // 2. Ensure Subscription Plan exists in DB
          let yearlyPlan = await SubscriptionPlan.findOne({
            targetRole: 'teacher',
            interval: 'yearly',
          });
          if (!yearlyPlan) {
            yearlyPlan = await SubscriptionPlan.create({
              name: 'Teacher Premium Annual',
              targetRole: 'teacher',
              interval: 'yearly',
              price: 20,
              durationDays: 365,
              features: [
                'Create & Host Unlimited Exams',
                'Access to Question Bank',
                'Live Proctoring & Analytics',
                'Priority Support',
              ],
              isActive: true,
            });
          }

          // 3. Update or Create UserSubscription
          await UserSubscription.updateMany(
            { userId: teacherId, role: 'teacher', status: 'active' },
            { status: 'expired' }
          );

          await UserSubscription.create({
            userId: teacherId,
            userEmail: teacherEmail || 'teacher@testify.io',
            userName: teacherName,
            role: 'teacher',
            planId: yearlyPlan._id,
            planName: 'Teacher Premium Annual ($20/yr)',
            interval: 'yearly',
            pricePaid: 20,
            startDate: new Date(),
            endDate: oneYearExpiry,
            status: 'active',
            paymentId: session.payment_intent || session.id || subscriptionId,
          });

          console.log(`✅ Teacher ${teacherId} Premium successfully activated for 1 year.`);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as any;
        const customerId = subscription.customer as string;
        const subscriptionId = subscription.id;
        const status = subscription.status; // active, past_due, canceled, unpaid

        const expiryDate = subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000)
          : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

        const isStillActive = status === 'active';

        const user = await User.findOneAndUpdate(
          {
            $or: [
              { stripeSubscriptionId: subscriptionId },
              { stripeCustomerId: customerId },
            ],
          },
          {
            isPremium: isStillActive,
            premiumStatus: isStillActive ? 'active' : status,
            premiumExpiresAt: expiryDate,
          },
          { new: true }
        );

        if (user) {
          console.log(
            `Updated subscription status for user ${user._id} to ${status} (isPremium: ${isStillActive})`
          );
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as any;
        const subscriptionId = subscription.id;

        await User.findOneAndUpdate(
          { stripeSubscriptionId: subscriptionId },
          {
            isPremium: false,
            premiumStatus: 'canceled',
          }
        );

        await UserSubscription.updateMany(
          { paymentId: subscriptionId },
          { status: 'cancelled' }
        );

        console.log(`Cancelled Teacher Premium subscription for ${subscriptionId}`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as any;
        const customerId = invoice.customer as string;

        await User.findOneAndUpdate(
          { stripeCustomerId: customerId },
          { premiumStatus: 'past_due' }
        );
        console.warn(`Payment failed on invoice for Stripe customer ${customerId}`);
        break;
      }

      default:
        console.log(`Unhandled Stripe event type: ${event.type}`);
    }

    // Record processed event for idempotency
    await PaymentEvent.create({
      eventId: event.id,
      eventType: event.type,
      processedAt: new Date(),
    });

    res.status(200).json({ received: true });
  } catch (error: unknown) {
    console.error(`Error processing Stripe event ${event.id}:`, error);
    res.status(500).json({ error: 'Failed to process webhook event' });
  }
};


/**
 * 4. GET /api/payments/teacher/revenue
 * Fetches authenticated teacher's verified revenue, sales analytics, exam breakdown, and transactions.
 * Strict access control: Teachers can ONLY access revenue for exams they created.
 */
export const getTeacherRevenue = async (
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

    if (user.role !== 'teacher' && user.role !== 'admin') {
      res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: 'Access Denied: Only teachers and administrators can access revenue analytics.',
      });
      return;
    }

    const teacherId = user.id;
    const teacherEmail = user.email;

    // 1. Find all paid/monetized exams created by this teacher
    const teacherExams = await Exam.find({
      $or: [
        { teacherId: teacherId },
        { teacherEmail: teacherEmail },
      ],
    });

    const teacherExamIds = teacherExams.map((e) => e._id);

    // 2. Query completed purchases for teacher's exams with strict teacher isolation
    const purchases = await ExamPurchase.find({
      $or: [
        { teacherId: teacherId },
        { teacherEmail: teacherEmail },
        { examId: { $in: teacherExamIds } },
      ],
      status: 'completed',
    }).sort({ createdAt: -1 });

    // Deduplicate purchases by transactionId or _id to prevent double counting
    const seen = new Set<string>();
    const dedupedPurchases: typeof purchases = [];
    purchases.forEach((p) => {
      const key = (p.transactionId || p._id.toString()).toString();
      if (!seen.has(key)) {
        seen.add(key);
        dedupedPurchases.push(p);
      }
    });

    // 3. Calculate Financial Metrics
    const grossRevenue = dedupedPurchases.reduce((sum, p) => sum + (p.pricePaid || 0), 0);
    const platformFeePercentage = 40; // 10% platform commission
    const platformFees = (grossRevenue * platformFeePercentage) / 100;
    const teacherEarnings = grossRevenue - platformFees;

    // Time calculations
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const todayPurchases = dedupedPurchases.filter((p) => new Date(p.createdAt) >= startOfToday);
    const monthPurchases = dedupedPurchases.filter((p) => new Date(p.createdAt) >= startOfMonth);

    const todayGrossRevenue = todayPurchases.reduce((sum, p) => sum + (p.pricePaid || 0), 0);
    const todayNetEarnings = todayGrossRevenue * (1 - platformFeePercentage / 100);

    const monthGrossRevenue = monthPurchases.reduce((sum, p) => sum + (p.pricePaid || 0), 0);
    const monthNetEarnings = monthGrossRevenue * (1 - platformFeePercentage / 100);

    // 4. Exam-wise Revenue Breakdown
    const examMap = new Map<string, { examTitle: string; unitPrice: number; count: number; gross: number }>();

    dedupedPurchases.forEach((p) => {
      const eId = p.examId.toString();
      const existing = examMap.get(eId);
      if (existing) {
        existing.count += 1;
        existing.gross += p.pricePaid || 0;
      } else {
        const foundExam = teacherExams.find((e) => e._id.toString() === eId);
        examMap.set(eId, {
          examTitle: foundExam?.title || 'Monetized Examination',
          unitPrice: p.pricePaid || foundExam?.price || 0,
          count: 1,
          gross: p.pricePaid || 0,
        });
      }
    });

    teacherExams.forEach((e) => {
      const eId = e._id.toString();
      if (!examMap.has(eId) && (e.price > 0 || e.accessType === 'paid')) {
        examMap.set(eId, {
          examTitle: e.title,
          unitPrice: e.price || 0,
          count: 0,
          gross: 0,
        });
      }
    });

    const examBreakdown = Array.from(examMap.entries()).map(([examId, item]) => {
      const pFee = (item.gross * platformFeePercentage) / 100;
      return {
        examId,
        examTitle: item.examTitle,
        unitPrice: item.unitPrice,
        soldCount: item.count,
        grossRevenue: item.gross,
        platformFee: pFee,
        netEarnings: item.gross - pFee,
        status: item.count > 0 ? 'ACTIVE SALES' : 'MONETIZED',
      };
    });

    // 5. Recent Customer Transactions Table Data
    const recentTransactions = dedupedPurchases.map((p) => ({
      id: p._id.toString(),
      studentId: p.studentId,
      studentName: p.studentName || 'Student Scholar',
      studentEmail: p.studentEmail,
      examId: p.examId.toString(),
      examTitle: examMap.get(p.examId.toString())?.examTitle || 'Certified Paid Exam',
      teacherId: p.teacherId,
      amount: p.pricePaid,
      currency: 'BDT',
      paymentProvider: p.paymentProvider || 'STRIPE',
      transactionId: p.transactionId || `TXN-${p._id.toString().slice(-8)}`,
      paymentStatus: p.status === 'completed' ? 'SUCCESS' : p.status.toUpperCase(),
      purchasedAt: p.createdAt.toISOString(),
      accessStatus: 'ACTIVE',
    }));

    res.status(200).json({
      success: true,
      data: {
        paidExamsCount: Array.from(examMap.keys()).length,
        totalSalesCount: dedupedPurchases.length,
        grossRevenue,
        platformFeePercentage,
        platformFees,
        teacherEarnings,
        todayGrossRevenue,
        todayNetEarnings,
        monthGrossRevenue,
        monthNetEarnings,
        pendingBalance: teacherEarnings,
        paidBalance: 0,
        examBreakdown,
        recentTransactions,
      },
    });
  } catch (error: unknown) {
    console.error('Error fetching teacher revenue:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch teacher revenue summary',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
