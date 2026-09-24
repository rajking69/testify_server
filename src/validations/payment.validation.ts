import { z } from 'zod';

export const teacherPremiumCheckoutSchema = z.object({
  body: z.object({
    planId: z.string().optional(),
    interval: z.enum(['monthly', 'yearly', 'month', 'year']).optional(),
    billingInterval: z.enum(['monthly', 'yearly', 'month', 'year']).optional(),
    priceAmount: z.number().positive().optional(),
    planName: z.string().optional(),
    successUrl: z.string().url().optional(),
    cancelUrl: z.string().url().optional(),
  }),
});

export const teacherPremiumStatusSchema = z.object({
  // No body/query/params validation needed - uses authenticated user
});

export const stripeWebhookSchema = z.object({
  // Stripe webhook validation is done via signature verification, not schema
  // Body is raw, not parsed JSON
});

export const checkoutSessionDetailsSchema = z.object({
  params: z.object({
    sessionId: z.string().min(1, 'Session ID is required'),
  }),
});

export const teacherRevenueSchema = z.object({
  query: z.object({
    page: z.string().regex(/^\d+$/).optional(),
    limit: z.string().regex(/^\d+$/).optional(),
  }),
});