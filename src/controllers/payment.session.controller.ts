import { Request, Response } from 'express';
import { stripe } from '../lib/stripe';
import { logger } from '../lib/logger';

export const getCheckoutSessionDetails = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { sessionId } = req.params;
    if (!sessionId) {
      res.status(400).json({ success: false, message: 'Session ID is required' });
      return;
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const interval = session.metadata?.interval || 'month';
    const isYearly = interval === 'year' || interval === 'yearly';
    const pricePaid = session.metadata?.pricePaid
      ? parseFloat(session.metadata.pricePaid)
      : session.amount_total
        ? session.amount_total / 100
        : isYearly
          ? 199.99
          : 19.99;
    const durationDays = isYearly ? 365 : 30;

    logger.info({ sessionId, pricePaid, interval }, 'Checkout session details fetched');
    res.status(200).json({
      success: true,
      data: {
        sessionId: session.id,
        paymentStatus: session.payment_status,
        customerEmail: session.customer_email,
        pricePaid,
        interval: isYearly ? 'yearly' : 'monthly',
        durationDays,
        formattedPrice: `$${pricePaid.toFixed(2)}`,
        planName: isYearly ? 'Teacher Elite (Yearly Plan)' : 'Teacher Pro (Monthly Plan)',
        message: `Your $${pricePaid.toFixed(2)} ${isYearly ? 'annual' : 'monthly'} subscription payment was verified successfully. Full privileges are unlocked for ${durationDays} days.`,
      },
    });
  } catch (error) {
    logger.error({ error, sessionId: req.params.sessionId }, 'Failed to retrieve checkout session details');
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve checkout session details',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};