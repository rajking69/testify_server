import { Request, Response } from 'express';
import { Question, IQuestion } from '../models/question.model';
import { validateQuestionPayload } from '../validations/question.validation';
import { MAX_QUESTIONS_PER_EXAM } from '../config/question.constants';

// 1. POST /api/questions - Create Question
export const createQuestion = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const validation = validateQuestionPayload(req.body);

    if (!validation.valid) {
      res.status(400).json({
        success: false,
        message: validation.message || 'Invalid question data',
      });
      return;
    }

    const {
      questionText,
      questionType,
      options = [],
      correctAnswer,
      correctOptionIndex = 0,
      explanation = '',
      category = 'General',
      subject,
      topic = '',
      difficulty = 'MEDIUM',
      marks = 1,
      tags = [],
      status = 'READY',
    } = req.body;

    const chosenSubject = String(subject || category || 'General').trim();

    const newQuestion = await Question.create({
      questionText: questionText.trim(),
      questionType,
      options: Array.isArray(options) ? options.map((o: string) => o.trim()) : [],
      correctAnswer: String(correctAnswer).trim(),
      correctOptionIndex: Number(correctOptionIndex) || 0,
      explanation: String(explanation).trim(),
      category: chosenSubject,
      subject: chosenSubject,
      topic: String(topic).trim(),
      difficulty,
      marks: Number(marks) || 1,
      tags: Array.isArray(tags) ? tags.map((t: string) => t.trim()).filter(Boolean) : [],
      status,
      version: 1,
      createdBy: user.id,
    });

    res.status(201).json({
      success: true,
      message: 'Question created successfully',
      data: newQuestion,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to create question',
      error: error instanceof Error ? error.message : error,
    });
  }
};

// 2. GET /api/questions - Get Questions with Pagination, Search, Sorting, & Filters
export const getQuestions = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const skip = (page - 1) * limit;

    const { search, category, subject, topic, difficulty, questionType, status, sort = 'newest' } = req.query;

    const filter: Record<string, unknown> = {};

    // Teachers only see their own questions; Admins can see all or filter by specific teacher
    if (user.role !== 'admin') {
      filter.createdBy = user.id;
    } else if (req.query.createdBy) {
      filter.createdBy = req.query.createdBy;
    }

    if (category || subject) {
      const catVal = String(category || subject);
      filter.$or = [
        { category: { $regex: new RegExp(catVal, 'i') } },
        { subject: { $regex: new RegExp(catVal, 'i') } },
      ];
    }

    if (topic) {
      filter.topic = { $regex: new RegExp(String(topic), 'i') };
    }

    if (difficulty) {
      filter.difficulty = String(difficulty).toUpperCase();
    }

    if (questionType) {
      filter.questionType = String(questionType).toUpperCase();
    }

    if (status) {
      filter.status = String(status).toUpperCase();
    }

    if (search && String(search).trim()) {
      const searchRegex = new RegExp(String(search).trim(), 'i');
      filter.$or = [
        { questionText: searchRegex },
        { category: searchRegex },
        { subject: searchRegex },
        { topic: searchRegex },
        { tags: searchRegex },
      ];
    }

    // Sort order
    let sortObj: any = { createdAt: -1 };
    switch (sort) {
      case 'oldest':
        sortObj = { createdAt: 1 };
        break;
      case 'marks_desc':
        sortObj = { marks: -1, createdAt: -1 };
        break;
      case 'marks_asc':
        sortObj = { marks: 1, createdAt: -1 };
        break;
      case 'title_asc':
        sortObj = { questionText: 1 };
        break;
      case 'newest':
      default:
        sortObj = { createdAt: -1 };
        break;
    }

    const [questions, total] = await Promise.all([
      Question.find(filter)
        .sort(sortObj)
        .skip(skip)
        .limit(limit),
      Question.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    res.status(200).json({
      success: true,
      message: 'Questions fetched successfully',
      count: questions.length,
      total,
      page,
      totalPages,
      data: questions,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch questions',
      error: error instanceof Error ? error.message : error,
    });
  }
};

// 3. GET /api/questions/:id - Get Single Question
export const getQuestionById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const user = req.user!;

    if (!id || id.length !== 24) {
      res.status(400).json({ success: false, message: 'Invalid question ID format' });
      return;
    }

    const question = await Question.findById(id);
    if (!question) {
      res.status(404).json({ success: false, message: 'Question not found' });
      return;
    }

    if (user.role !== 'admin' && question.createdBy !== user.id) {
      res.status(403).json({
        success: false,
        message: 'Forbidden. You do not have permission to view this question.',
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: question,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch question',
      error: error instanceof Error ? error.message : error,
    });
  }
};

// 4. PATCH /api/questions/:id - Update Question (Increments Version History)
export const updateQuestion = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const user = req.user!;

    if (!id || id.length !== 24) {
      res.status(400).json({ success: false, message: 'Invalid question ID format' });
      return;
    }

    const existing = await Question.findById(id);
    if (!existing) {
      res.status(404).json({ success: false, message: 'Question not found' });
      return;
    }

    if (user.role !== 'admin' && existing.createdBy !== user.id) {
      res.status(403).json({
        success: false,
        message: 'Forbidden. You are not authorized to edit this question.',
      });
      return;
    }

    const mergedPayload = {
      ...existing.toObject(),
      ...req.body,
    };

    const validation = validateQuestionPayload(mergedPayload);
    if (!validation.valid) {
      res.status(400).json({
        success: false,
        message: validation.message || 'Invalid question data',
      });
      return;
    }

    const allowedFields = [
      'questionText',
      'questionType',
      'options',
      'correctAnswer',
      'correctOptionIndex',
      'explanation',
      'category',
      'subject',
      'topic',
      'difficulty',
      'marks',
      'tags',
      'status',
    ];

    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        (existing as any)[field] = req.body[field];
      }
    });

    if (req.body.subject && !req.body.category) {
      existing.category = req.body.subject;
    } else if (req.body.category && !req.body.subject) {
      existing.subject = req.body.category;
    }

    // Increment version history
    existing.version = (existing.version || 1) + 1;

    await existing.save();

    res.status(200).json({
      success: true,
      message: 'Question updated successfully',
      data: existing,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update question',
      error: error instanceof Error ? error.message : error,
    });
  }
};

// 5. PATCH /api/questions/:id/archive - Toggle Archive Status
export const toggleArchiveQuestion = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const user = req.user!;

    if (!id || id.length !== 24) {
      res.status(400).json({ success: false, message: 'Invalid question ID format' });
      return;
    }

    const existing = await Question.findById(id);
    if (!existing) {
      res.status(404).json({ success: false, message: 'Question not found' });
      return;
    }

    if (user.role !== 'admin' && existing.createdBy !== user.id) {
      res.status(403).json({
        success: false,
        message: 'Forbidden. You are not authorized to archive this question.',
      });
      return;
    }

    const nextStatus = existing.status === 'ARCHIVED' ? 'READY' : 'ARCHIVED';
    existing.status = nextStatus;
    existing.version = (existing.version || 1) + 1;
    await existing.save();

    res.status(200).json({
      success: true,
      message: `Question ${nextStatus === 'ARCHIVED' ? 'archived' : 'restored'} successfully`,
      data: existing,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to toggle archive status',
      error: error instanceof Error ? error.message : error,
    });
  }
};

// 6. DELETE /api/questions/:id - Delete Question
export const deleteQuestion = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const user = req.user!;

    if (!id || id.length !== 24) {
      res.status(400).json({ success: false, message: 'Invalid question ID format' });
      return;
    }

    const existing = await Question.findById(id);
    if (!existing) {
      res.status(404).json({ success: false, message: 'Question not found' });
      return;
    }

    if (user.role !== 'admin' && existing.createdBy !== user.id) {
      res.status(403).json({
        success: false,
        message: 'Forbidden. You are not authorized to delete this question.',
      });
      return;
    }

    await Question.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Question deleted successfully',
      data: { id },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete question',
      error: error instanceof Error ? error.message : error,
    });
  }
};

// 7. POST /api/questions/select-for-exam - Select questions for an exam (Manual or Random, max 100)
export const selectQuestionsForExam = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { mode = 'manual', questionIds = [], count = 10, category, subject, topic, difficulty, questionType } = req.body;

    if (mode === 'manual') {
      if (!Array.isArray(questionIds) || questionIds.length === 0) {
        res.status(400).json({
          success: false,
          message: 'Please select at least 1 question for the exam.',
        });
        return;
      }

      if (questionIds.length > MAX_QUESTIONS_PER_EXAM) {
        res.status(400).json({
          success: false,
          message: `Maximum allowed questions per exam is ${MAX_QUESTIONS_PER_EXAM}. You selected ${questionIds.length}.`,
        });
        return;
      }

      const questions = await Question.find({
        _id: { $in: questionIds },
        createdBy: user.role === 'admin' ? { $exists: true } : user.id,
      });

      res.status(200).json({
        success: true,
        message: `Successfully selected ${questions.length} questions manually.`,
        data: questions,
      });
      return;
    } else if (mode === 'random') {
      const requestedCount = Number(count) || 10;

      if (requestedCount < 1 || requestedCount > MAX_QUESTIONS_PER_EXAM) {
        res.status(400).json({
          success: false,
          message: `Random selection count must be between 1 and ${MAX_QUESTIONS_PER_EXAM}. Requested: ${requestedCount}.`,
        });
        return;
      }

      const matchFilter: Record<string, unknown> = {};
      if (user.role !== 'admin') matchFilter.createdBy = user.id;

      if (category || subject) {
        const catVal = String(category || subject);
        matchFilter.$or = [
          { category: { $regex: new RegExp(catVal, 'i') } },
          { subject: { $regex: new RegExp(catVal, 'i') } },
        ];
      }
      if (topic) matchFilter.topic = { $regex: new RegExp(String(topic), 'i') };
      if (difficulty) matchFilter.difficulty = String(difficulty).toUpperCase();
      if (questionType) matchFilter.questionType = String(questionType).toUpperCase();
      matchFilter.status = 'READY';

      const randomQuestions = await Question.aggregate([
        { $match: matchFilter },
        { $sample: { size: requestedCount } },
      ]);

      res.status(200).json({
        success: true,
        message: `Successfully selected ${randomQuestions.length} random questions.`,
        data: randomQuestions,
      });
      return;
    } else {
      res.status(400).json({
        success: false,
        message: 'Invalid mode. Allowed modes are "manual" or "random".',
      });
      return;
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to select questions for exam',
      error: error instanceof Error ? error.message : error,
    });
  }
};