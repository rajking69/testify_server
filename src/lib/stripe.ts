import Stripe from 'stripe';
import { env } from '../config/env';

if (!env.stripe_secret_key) {
  console.warn('⚠️ STRIPE_SECRET_KEY is not configured in backend .env');
}

export const stripe = new Stripe(env.stripe_secret_key || 'sk_test_placeholder', {
  apiVersion: '2025-02-24.acacia' as any,
  typescript: true,
});

export const STRIPE_TEACHER_PREMIUM_CONFIG = {
  productName: 'Testify Teacher Premium',
  productDescription:
    'Annual subscription for Testify teachers to conduct unlimited exams, manage question banks, and access advanced analytics.',
  amountCents: 2000, // $20.00 USD
  currency: 'usd',
  interval: 'year' as Stripe.PriceCreateParams.Recurring.Interval,
};

let cachedTeacherPremiumPriceId: string | null = env.stripe_teacher_premium_price_id || null;

/**
 * Reuses or automatically creates the single Stripe Product and recurring Price for Teacher Premium ($20/year).
 */
export const getOrCreateTeacherPremiumPriceId = async (): Promise<string> => {
  if (cachedTeacherPremiumPriceId) {
    return cachedTeacherPremiumPriceId;
  }

  try {
    // 1. Search for existing product
    const products = await stripe.products.list({
      limit: 10,
      active: true,
    });

    let teacherProduct = products.data.find(
      (p) => p.name.toLowerCase() === STRIPE_TEACHER_PREMIUM_CONFIG.productName.toLowerCase()
    );

    // 2. Create product if it doesn't exist
    if (!teacherProduct) {
      console.log('Creating Stripe Product: Testify Teacher Premium...');
      teacherProduct = await stripe.products.create({
        name: STRIPE_TEACHER_PREMIUM_CONFIG.productName,
        description: STRIPE_TEACHER_PREMIUM_CONFIG.productDescription,
        metadata: {
          app: 'testify',
          role: 'teacher',
          plan: 'premium_annual',
        },
      });
    }

    // 3. Search for active recurring yearly price for this product
    const prices = await stripe.prices.list({
      product: teacherProduct.id,
      active: true,
      limit: 10,
    });

    let teacherPrice = prices.data.find(
      (pr) =>
        pr.recurring?.interval === STRIPE_TEACHER_PREMIUM_CONFIG.interval &&
        pr.unit_amount === STRIPE_TEACHER_PREMIUM_CONFIG.amountCents &&
        pr.currency.toLowerCase() === STRIPE_TEACHER_PREMIUM_CONFIG.currency
    );

    // 4. Create price if not found
    if (!teacherPrice) {
      console.log('Creating Stripe recurring Price ($20/year) for Testify Teacher Premium...');
      teacherPrice = await stripe.prices.create({
        product: teacherProduct.id,
        unit_amount: STRIPE_TEACHER_PREMIUM_CONFIG.amountCents,
        currency: STRIPE_TEACHER_PREMIUM_CONFIG.currency,
        recurring: {
          interval: STRIPE_TEACHER_PREMIUM_CONFIG.interval,
        },
        metadata: {
          app: 'testify',
          role: 'teacher',
          plan: 'premium_annual',
        },
      });
    }

    cachedTeacherPremiumPriceId = teacherPrice.id;
    return cachedTeacherPremiumPriceId;
  } catch (error) {
    console.error('Failed to get or create Teacher Premium Price in Stripe:', error);
    throw error;
  }
};

/**
 * Creates a dynamic Stripe Checkout Session for Teacher Premium plans (Monthly $19.99/mo, Yearly $199.99/yr, or custom Admin price).
 */
export const createTeacherPremiumCheckoutSession = async ({
  teacherId,
  teacherEmail,
  teacherName,
  priceAmount = 19.99,
  interval = 'month',
  planName = 'Testify Teacher Pro',
  planId,
  successUrl,
  cancelUrl,
}: {
  teacherId: string;
  teacherEmail: string;
  teacherName?: string;
  priceAmount?: number;
  interval?: 'month' | 'year' | 'monthly' | 'yearly';
  planName?: string;
  planId?: string;
  successUrl?: string;
  cancelUrl?: string;
}): Promise<Stripe.Checkout.Session> => {
  const rawInterval = String(interval || '').toLowerCase();
  const stripeInterval: 'month' | 'year' = (rawInterval === 'year' || rawInterval === 'yearly' || rawInterval === 'annual') ? 'year' : 'month';
  const amountCents = Math.max(50, Math.round((priceAmount || (stripeInterval === 'year' ? 199.99 : 19.99)) * 100));

  const frontendBaseUrl = env.frontend_url || 'http://localhost:3000';
  const defaultSuccessUrl = `${frontendBaseUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`;
  const defaultCancelUrl = `${frontendBaseUrl}/payment/cancel`;

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'subscription',
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: planName,
            description: stripeInterval === 'year'
              ? 'Yearly subscription for Testify teachers to conduct unlimited exams, access question bank, and get priority support.'
              : 'Monthly subscription for Testify teachers to conduct unlimited exams, access question bank, and get priority support.',
          },
          unit_amount: amountCents,
          recurring: {
            interval: stripeInterval,
          },
        },
        quantity: 1,
      },
    ],
    customer_email: teacherEmail,
    client_reference_id: teacherId,
    metadata: {
      type: 'TEACHER_PREMIUM',
      teacherId,
      teacherEmail,
      teacherName: teacherName || '',
      planId: planId || '',
      interval: stripeInterval,
      pricePaid: String(priceAmount),
    },
    subscription_data: {
      metadata: {
        type: 'TEACHER_PREMIUM',
        teacherId,
        teacherEmail,
        teacherName: teacherName || '',
        planId: planId || '',
        interval: stripeInterval,
        pricePaid: String(priceAmount),
      },
    },
    success_url: successUrl || defaultSuccessUrl,
    cancel_url: cancelUrl || defaultCancelUrl,
  });

  return session;
};

/**
 * Verifies Stripe Webhook signature with raw request body.
 * Signature verification is mandatory in all environments.
 * Throws if webhook secret is not configured or signature is missing.
 */
export const constructStripeEvent = (
  rawBody: Buffer | string,
  signature: string | string[] | undefined
): Stripe.Event => {
  const webhookSecret = env.stripe_webhook_secret;
  const sigHeader = Array.isArray(signature) ? signature[0] : signature;

  if (!webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  }
  if (!sigHeader) {
    throw new Error('Missing Stripe signature header');
  }
  return stripe.webhooks.constructEvent(rawBody, sigHeader, webhookSecret);
};
