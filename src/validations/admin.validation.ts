import { z } from 'zod';

export const userQuerySchema = z.object({
  query: z.object({
    role: z.enum(['student', 'teacher', 'admin', 'all']).optional(),
    status: z.enum(['active', 'suspended', 'deactivated', 'inactive', 'all']).optional(),
    search: z.string().optional(),
    page: z.string().regex(/^\d+$/).optional(),
    limit: z.string().regex(/^\d+$/).optional(),
  }),
});

export const userIdParamSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'User ID is required'),
  }),
});

export const updateUserSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'User ID is required'),
  }),
  body: z.object({
    role: z.enum(['student', 'teacher', 'admin']).optional(),
    status: z.enum(['active', 'suspended', 'deactivated', 'inactive']).optional(),
    department: z.string().optional(),
  }),
});

export const featureFlagSchema = z.object({
  body: z.object({
    key: z.string().min(1, 'Feature flag key is required').max(100),
    name: z.string().min(1, 'Feature flag name is required').max(200),
    description: z.string().optional(),
    category: z.string().optional(),
    enabled: z.boolean().optional(),
  }),
});

export const featureFlagIdParamSchema = z.object({
  params: z.object({
    id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid feature flag ID format'),
  }),
});

export const systemConfigSchema = z.object({
  params: z.object({
    key: z.string().min(1, 'Config key is required'),
  }),
  body: z.object({
    value: z.unknown(),
  }),
});

export const analyticsQuerySchema = z.object({
  query: z.object({
    days: z.string().regex(/^\d+$/).optional(),
  }),
});