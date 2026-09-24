import { Request, Response } from 'express';
import { aiService, AIError } from '../services/ai.service';
import { ExamAttempt } from '../models/exam-attempt.model';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

const aiChatRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip || 'unknown'),
  message: {
    success: false,
    code: 'AI_RATE_LIMIT',
    message: 'Too many AI requests. Please wait a moment before sending another message.',
  },
  skip: (req) => req.method !== 'POST',
});

export const aiChatRateLimiter = aiChatRateLimit;

export const chatWithGekko = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({
        success: false,
        code: 'UNAUTHORIZED',
        message: 'Authentication required to speak with Gekko AI.',
      });
      return;
    }

    const userRole = user.role || 'student';

    if (userRole !== 'student' && userRole !== 'teacher' && userRole !== 'admin') {
      res.status(403).json({
        success: false,
        code: 'ROLE_NOT_SUPPORTED',
        message: 'Gekko AI is only available for Student, Teacher, and Admin accounts.',
      });
      return;
    }

    const activeExamAttempt = await ExamAttempt.findOne({
      $or: [
        { studentId: user.id },
        { studentId: (user as any)._id?.toString() },
        { studentEmail: user.email },
      ],
      status: 'in_progress',
      expiresAt: { $gt: new Date() },
    });

    if (activeExamAttempt) {
      res.status(403).json({
        success: false,
        code: 'ACTIVE_EXAM_RESTRICTION',
        message: 'Gekko is unavailable while an exam is in progress.',
      });
      return;
    }

    const { message, context, history, stream } = req.body;

    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({
        success: false,
        code: 'INVALID_INPUT',
        message: 'Message cannot be empty.',
      });
      return;
    }

    const cleanMessage = message.trim();
    if (cleanMessage.length > 2000) {
      res.status(400).json({
        success: false,
        code: 'MESSAGE_TOO_LONG',
        message: 'Message exceeds maximum length of 2000 characters.',
      });
      return;
    }

    const userName = user.name || 'Learner';

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      let hasError = false;
      let sentDone = false;

      const sendEvent = (data: any) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      const sendError = (error: AIError) => {
        sendEvent({
          error: {
            code: error.code,
            message: error.message,
            provider: error.provider,
          },
        });
      };

      try {
        for await (const chunk of aiService.generateGekkoResponseStream(
          cleanMessage,
          userRole,
          userName,
          context,
          history
        )) {
          if (chunk.text) {
            sendEvent({ chunk: chunk.text, provider: chunk.provider });
          }
          if (chunk.isComplete) {
            if (!sentDone) {
              sendEvent({ done: true, provider: chunk.provider });
              sentDone = true;
            }
          }
        }
      } catch (streamError) {
        hasError = true;
        const error = classifyStreamError(streamError);
        sendError(error);
      } finally {
        if (!hasError && !sentDone) {
          sendEvent({ done: true });
        }
        res.end();
      }
      return;
    }

    const aiResponseText = await aiService.generateGekkoResponse(
      cleanMessage,
      userRole,
      userName,
      context,
      history
    );

    res.status(200).json({
      success: true,
      data: {
        message: aiResponseText,
        sender: 'gekko',
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('[Gekko AI Controller Error]:', error);
    res.status(500).json({
      success: false,
      code: 'AI_SERVICE_ERROR',
      message: 'Sorry, Gekko is temporarily unavailable. Please try again.',
    });
  }
};

function classifyStreamError(err: any): AIError {
  const message = err?.message || String(err);
  if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
    return { code: 'AI_TIMEOUT', message: 'AI request timed out', isTemporary: true, provider: 'gemini' };
  }
  if (message.includes('429') || message.includes('rate limit')) {
    return { code: 'AI_RATE_LIMIT', message: 'AI rate limit exceeded', isTemporary: true, provider: 'gemini' };
  }
  if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('504')) {
    return { code: 'AI_SERVER_ERROR', message: 'AI server error', isTemporary: true, provider: 'gemini' };
  }
  return { code: 'AI_SERVICE_ERROR', message: 'AI service error', isTemporary: false, provider: 'gemini' };
}