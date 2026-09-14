import { Request, Response } from 'express';
import { aiService } from '../services/ai.service';
import { ExamAttempt } from '../models/exam-attempt.model';

/**
 * POST /api/ai/chat
 * Primary endpoint for chatting with Gekko AI Study Assistant
 */
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

    // Role Security Check: Only Student and Teacher roles are allowed to access Gekko AI
    if (userRole !== 'student' && userRole !== 'teacher') {
      res.status(403).json({
        success: false,
        code: 'ROLE_NOT_SUPPORTED',
        message: 'Gekko AI is only available for Student and Teacher accounts.',
      });
      return;
    }

    // Server-Side Anti-Cheating & Exam Restriction Verification:
    // Check if the user currently has an active in-progress exam attempt.
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

    const { message, context, history } = req.body;

    // Validation
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

    // Generate response via Gekko AI Service
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
