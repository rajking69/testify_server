import { z } from 'zod';

export const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId format');

export const examIdParamSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Exam ID is required'),
  }),
});

export const examQuerySchema = z.object({
  query: z.object({
    category: z.string().optional(),
    subject: z.string().optional(),
    search: z.string().optional(),
    accessType: z.enum(['free', 'paid', 'subscription_only', 'all']).optional(),
    teacherId: z.string().optional(),
    teacherEmail: z.string().optional(),
    mine: z.enum(['true', 'false']).optional(),
    isPublished: z.enum(['true', 'false']).optional(),
    page: z.string().regex(/^\d+$/).optional(),
    limit: z.string().regex(/^\d+$/).optional(),
    sort: z.enum(['newest', 'oldest', 'title_asc', 'marks_desc', 'marks_asc']).optional(),
  }),
});

export const createExamSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'Exam title is required').max(200),
    description: z.string().optional(),
    category: z.string().optional(),
    subject: z.string().optional(),
    scheduleType: z.enum(['scheduled', 'flexible']).optional(),
    startDateTime: z.string().datetime().optional(),
    endDateTime: z.string().datetime().optional(),
    date: z.string().optional(),
    accessType: z.enum(['free', 'paid', 'subscription_only']).optional(),
    status: z.enum(['draft', 'published', 'scheduled']).optional(),
    price: z.number().min(0).optional(),
    durationMinutes: z.number().int().positive().optional(),
    totalMarks: z.number().int().positive().optional(),
    passMarks: z.number().int().nonnegative().optional(),
    passMark: z.number().int().nonnegative().optional(),
    passPercentage: z.number().int().min(0).max(100).optional(),
    questions: z.array(z.object({
      id: z.string().optional(),
      questionText: z.string().min(1, 'Question text is required'),
      options: z.array(z.string()).optional(),
      correctOptionIndex: z.number().int().nonnegative().optional(),
      correctAnswer: z.string().optional(),
      marks: z.number().int().positive().optional(),
      explanation: z.string().optional(),
    })).optional(),
    isPublished: z.boolean().optional(),
    joinCode: z.string().optional(),
    accessToken: z.string().optional(),
    schedule: z.object({
      startWindow: z.string().datetime().optional(),
      endWindow: z.string().datetime().optional(),
    }).optional(),
    requireCamera: z.boolean().optional(),
  }),
});

export const updateExamSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Exam ID is required'),
  }),
  body: z.object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().optional(),
    category: z.string().optional(),
    subject: z.string().optional(),
    accessType: z.enum(['free', 'paid', 'subscription_only']).optional(),
    status: z.enum(['draft', 'published', 'scheduled']).optional(),
    price: z.number().min(0).optional(),
    durationMinutes: z.number().int().positive().optional(),
    totalMarks: z.number().int().positive().optional(),
    passMarks: z.number().int().nonnegative().optional(),
    passMark: z.number().int().nonnegative().optional(),
    passPercentage: z.number().int().min(0).max(100).optional(),
    questions: z.array(z.object({
      id: z.string().optional(),
      questionText: z.string().min(1),
      options: z.array(z.string()).optional(),
      correctOptionIndex: z.number().int().nonnegative().optional(),
      correctAnswer: z.string().optional(),
      marks: z.number().int().positive().optional(),
      explanation: z.string().optional(),
    })).optional(),
    isPublished: z.boolean().optional(),
    joinCode: z.string().optional(),
    accessToken: z.string().optional(),
    scheduleType: z.enum(['scheduled', 'flexible']).optional(),
    startDateTime: z.string().datetime().optional(),
    endDateTime: z.string().datetime().optional(),
    date: z.string().optional(),
    schedule: z.object({
      startWindow: z.string().datetime().optional(),
      endWindow: z.string().datetime().optional(),
    }).optional(),
    requireCamera: z.boolean().optional(),
  }),
});

export const purchaseExamSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Exam ID is required'),
  }),
  body: z.object({
    paymentId: z.string().optional(),
    transactionId: z.string().optional(),
    paymentProvider: z.enum(['STRIPE', 'SSLCOMMERZ', 'BKASH', 'SIMULATED', 'CARD']).optional(),
  }),
});

export const submitExamSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Exam ID is required'),
  }),
  body: z.object({
    answers: z.array(z.object({
      questionId: z.string().min(1),
      selectedOptionIndex: z.number().int().optional(),
      submittedAnswer: z.union([z.string(), z.number()]).optional(),
    })).min(1, 'At least one answer is required'),
    timeTakenSeconds: z.number().int().nonnegative().optional(),
  }),
});

export const startExamAttemptSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Exam ID is required'),
  }),
});

export const examHeartbeatSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Exam ID is required'),
  }),
  body: z.object({
    currentQuestionIndex: z.number().int().nonnegative().optional(),
    answersCount: z.number().int().nonnegative().optional(),
    cameraActive: z.boolean().optional(),
    tabSwitchCount: z.number().int().nonnegative().optional(),
    faceDetected: z.boolean().optional(),
  }),
});

export const transcriptSchema = z.object({
  params: z.object({
    id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid submission ID format'),
  }),
});

export const liveMonitoringSchema = z.object({
  params: z.object({
    examId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid exam ID format'),
  }),
});

export const teacherSubmissionsSchema = z.object({
  query: z.object({
    page: z.string().regex(/^\d+$/).optional(),
    limit: z.string().regex(/^\d+$/).optional(),
  }),
});