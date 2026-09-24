import { Request, Response } from 'express';
import User from '../models/user.model';
import { UserSubscription } from '../models/subscription.model';
import { SubscriptionPlan } from '../models/subscription-plan.model';
import { PaymentEvent } from '../models/payment-event.model';
import {
  constructStripeEvent,
  stripe,
} from '../lib/stripe';
import { logger } from '../lib/logger';

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
    logger.error({ error: err.message }, 'Stripe webhook signature verification failed');
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  const existingEvent = await PaymentEvent.findOne({ eventId: event.id });
  if (existingEvent) {
    logger.info({ eventId: event.id, eventType: event.type }, 'Stripe event already processed');
    res.status(200).json({ received: true, alreadyProcessed: true });
    return;
  }

  logger.info({ eventId: event.id, eventType: event.type }, 'Processing Stripe webhook event');

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
        const planId = session.metadata?.planId || session.subscription_data?.metadata?.planId;
        const stripeInterval = session.metadata?.interval || session.subscription_data?.metadata?.interval || 'year';
        const pricePaidRaw = session.metadata?.pricePaid || session.subscription_data?.metadata?.pricePaid;

        if (teacherId) {
          const isYearly = stripeInterval === 'year' || stripeInterval === 'yearly';
          const durationDays = isYearly ? 365 : 30;
          const pricePaid = pricePaidRaw ? parseFloat(pricePaidRaw) : (isYearly ? 199.99 : 19.99);

          const expiryDate = new Date();
          expiryDate.setDate(expiryDate.getDate() + durationDays);

          await User.findByIdAndUpdate(teacherId, {
            isPremium: true,
            premiumStatus: 'active',
            premiumExpiresAt: expiryDate,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
          });

          let targetPlan = planId ? await SubscriptionPlan.findById(planId) : null;
          if (!targetPlan) {
            targetPlan = await SubscriptionPlan.findOne({
              targetRole: 'teacher',
              interval: isYearly ? 'yearly' : 'monthly',
            });
          }
          if (!targetPlan) {
            targetPlan = await SubscriptionPlan.create({
              name: isYearly ? 'Teacher Premium Annual' : 'Teacher Pro Monthly',
              targetRole: 'teacher',
              interval: isYearly ? 'yearly' : 'monthly',
              price: pricePaid,
              durationDays: durationDays,
              features: [
                'Create & Host Unlimited Exams',
                'Access to Question Bank',
                'Live Proctoring & Analytics',
                'Priority Support',
              ],
              isActive: true,
            });
          }

          await UserSubscription.updateMany(
            { userId: teacherId, role: 'teacher', status: 'active' },
            { status: 'expired' }
          );

          await UserSubscription.create({
            userId: teacherId,
            userEmail: teacherEmail || 'teacher@testify.io',
            userName: teacherName,
            role: 'teacher',
            planId: targetPlan._id,
            planName: targetPlan.name || (isYearly ? 'Teacher Premium Annual' : 'Teacher Pro Monthly'),
            interval: isYearly ? 'yearly' : 'monthly',
            pricePaid: pricePaid,
            startDate: new Date(),
            endDate: expiryDate,
            status: 'active',
            paymentId: session.payment_intent || session.id || subscriptionId,
          });

          logger.info({ teacherId, isYearly }, 'Teacher premium successfully activated');
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as any;
        const customerId = subscription.customer as string;
        const subscriptionId = subscription.id;
        const status = subscription.status;

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
          logger.info({ userId: user._id, status, isPremium: isStillActive }, 'Subscription status updated');
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

        logger.info({ subscriptionId }, 'Teacher premium subscription cancelled');
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as any;
        const customerId = invoice.customer as string;

        await User.findOneAndUpdate(
          { stripeCustomerId: customerId },
          { premiumStatus: 'past_due' }
        );
        logger.warn({ customerId }, 'Payment failed on invoice');
        break;
      }

      case 'customer.subscription.trial_will_end': {
        const subscription = event.data.object as any;
        const subscriptionId = subscription.id;
        const customerId = subscription.customer as string;
        
        // Notify teacher that trial is ending soon (3 days before)
        await User.findOneAndUpdate(
          { stripeSubscriptionId: subscriptionId },
          { premiumStatus: 'trial_ending' }
        );
        logger.info({ subscriptionId, customerId }, 'Subscription trial ending soon');
        break;
      }

      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as any;
        // Handle one-time payment success (non-subscription)
        // This can be used for direct exam purchases if we move to Stripe PaymentIntents
        logger.info({ paymentIntentId: paymentIntent.id, amount: paymentIntent.amount }, 'Payment intent succeeded');
        break;
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as any;
        logger.warn({ paymentIntentId: paymentIntent.id, error: paymentIntent.last_payment_error }, 'Payment intent failed');
        break;
      }

      default:
        logger.info({ eventType: event.type }, 'Unhandled Stripe event type');
    }

    await PaymentEvent.create({
      eventId: event.id,
      eventType: event.type,
      processedAt: new Date(),
    });

    res.status(200).json({ received: true });
  } catch (error) {
    logger.error({ error, eventId: event.id }, 'Error processing Stripe webhook event');
    res.status(500).json({ error: 'Failed to process webhook event' });
  }
};