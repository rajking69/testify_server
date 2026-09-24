import { Request, Response } from 'express';
import { PracticeSession } from '../models/practice-session.model';
import { Question } from '../models/question.model';
import User from '../models/user.model';

// Start a new practice session by drawing questions from question bank
export const startPracticeSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { category, subject, topic, topics, difficulty, difficulties, count = 10 } = req.body;

    const filter: any = { status: 'READY' };
    if (category) filter.category = category;
    if (subject) filter.subject = subject;
    
    if (topics && Array.isArray(topics) && topics.length > 0) {
      filter.topic = { $in: topics };
    } else if (topic) {
      filter.topic = topic;
    }

    if (difficulties && Array.isArray(difficulties) && difficulties.length > 0) {
      filter.difficulty = { $in: difficulties };
    } else if (difficulty) {
      filter.difficulty = difficulty;
    }

    const countNum = parseInt(count as string, 10) || 10;
    const questions = await Question.aggregate([
      { $match: filter },
      { $sample: { size: countNum } },
    ]);

    if (questions.length === 0) {
      res.status(404).json({
        success: false,
        message: 'No questions found matching the practice criteria.',
      });
      return;
    }

    const questionIds = questions.map((q) => q._id);

    const session = await PracticeSession.create({
      userId,
      category: category || 'General',
      subject,
      topic,
      difficulty,
      totalQuestions: questionIds.length,
      questions: questionIds,
      answers: [],
      status: 'IN_PROGRESS',
      startedAt: new Date(),
    });

    // Return session with questions (excluding correct answers for test security)
    const sanitizedQuestions = questions.map((q) => ({
      _id: q._id,
      id: q._id,
      questionText: q.questionText,
      questionType: q.questionType,
      options: q.options,
      category: q.category,
      subject: q.subject,
      topic: q.topic,
      difficulty: q.difficulty,
      marks: q.marks,
    }));

    res.status(201).json({
      success: true,
      message: 'Practice session started',
      data: {
        session,
        questions: sanitizedQuestions,
      },
    });
  } catch (error: unknown) {
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : String(error) });
  }
};

// Submit answer for a question in active practice session
export const submitPracticeAnswer = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    const { questionId, selectedOption, selectedOptionIndex, timeSpentSeconds = 0 } = req.body;

    const session = await PracticeSession.findOne({ _id: id, userId });
    if (!session) {
      res.status(404).json({ success: false, message: 'Practice session not found' });
      return;
    }

    if (session.status !== 'IN_PROGRESS') {
      res.status(400).json({ success: false, message: 'Session is already completed' });
      return;
    }

    const question = await Question.findById(questionId);
    if (!question) {
      res.status(404).json({ success: false, message: 'Question not found' });
      return;
    }

    let isCorrect = false;
    if (selectedOption !== undefined && question.correctAnswer) {
      isCorrect = selectedOption.trim().toLowerCase() === question.correctAnswer.trim().toLowerCase();
    } else if (selectedOptionIndex !== undefined && question.correctOptionIndex !== undefined) {
      isCorrect = selectedOptionIndex === question.correctOptionIndex;
    }

    // Update or add answer in session
    const existingIndex = session.answers.findIndex(
      (a: any) => a.questionId.toString() === questionId
    );

    if (existingIndex > -1) {
      session.answers[existingIndex] = {
        questionId,
        selectedOption,
        selectedOptionIndex,
        isCorrect,
        timeSpentSeconds,
      };
    } else {
      session.answers.push({
        questionId,
        selectedOption,
        selectedOptionIndex,
        isCorrect,
        timeSpentSeconds,
      });
    }

    await session.save();

    res.status(200).json({
      success: true,
      message: 'Answer submitted',
      data: {
        isCorrect,
        explanation: question.explanation,
        correctAnswer: question.correctAnswer,
      },
    });
  } catch (error: unknown) {
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : String(error) });
  }
};

// Finish & Evaluate Practice Session
export const finishPracticeSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    const session = await PracticeSession.findOne({ _id: id, userId }).populate('questions');
    if (!session) {
      res.status(404).json({ success: false, message: 'Practice session not found' });
      return;
    }

    let correctCount = 0;
    let wrongCount = 0;
    let totalTime = 0;

    session.answers.forEach((ans: any) => {
      if (ans.isCorrect) {
        correctCount += 1;
      } else {
        wrongCount += 1;
      }
      totalTime += ans.timeSpentSeconds || 0;
    });

    const totalAnswered = session.answers.length;
    const accuracy = totalAnswered > 0 ? Math.round((correctCount / totalAnswered) * 100) : 0;

    session.status = 'COMPLETED';
    session.score = correctCount;
    session.correctAnswersCount = correctCount;
    session.wrongAnswersCount = wrongCount;
    session.accuracyPercentage = accuracy;
    session.totalTimeSeconds = totalTime;
    session.completedAt = new Date();

    await session.save();

    res.status(200).json({
      success: true,
      message: 'Practice session completed',
      data: session,
    });
  } catch (error: unknown) {
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : String(error) });
  }
};

// Get user practice history
export const getPracticeHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { page = '1', limit = '10' } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    const [sessions, total] = await Promise.all([
      PracticeSession.find({ userId, status: 'COMPLETED' })
        .sort({ completedAt: -1 })
        .skip(skip)
        .limit(limitNum),
      PracticeSession.countDocuments({ userId, status: 'COMPLETED' }),
    ]);

    res.status(200).json({
      success: true,
      count: sessions.length,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      data: sessions,
    });
  } catch (error: unknown) {
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : String(error) });
  }
};

// Get available subjects and topics from the question bank
export const getPracticeSubjects = async (req: Request, res: Response): Promise<void> => {
  try {
    const subjects = await Question.aggregate([
      { $match: { status: 'READY' } },
      { $group: { _id: "$subject", topics: { $addToSet: "$topic" } } },
      { $project: { _id: 0, name: "$_id", topics: 1 } },
      { $sort: { name: 1 } }
    ]);

    // Filter out empty strings from topics if any
    const formattedSubjects = subjects.map(s => ({
      name: s.name || 'General',
      topics: s.topics.filter((t: string) => t && t.trim() !== '')
    }));

    res.status(200).json({
      success: true,
      data: formattedSubjects,
    });
  } catch (error: unknown) {
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : String(error) });
  }
};

export const getPracticeSessionById = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    const session = await PracticeSession.findOne({ _id: id, userId }).populate('questions');
    if (!session) {
      res.status(404).json({ success: false, message: 'Practice session not found' });
      return;
    }

    const sessionData: any = session.toObject();
    const answeredQuestionIds = new Set(sessionData.answers.map((a: any) => a.questionId.toString()));

    if (Array.isArray(sessionData.questions)) {
      sessionData.questions = sessionData.questions.map((q: any) => {
        const isAnswered = answeredQuestionIds.has(q._id.toString());
        return {
          _id: q._id,
          id: q._id,
          questionText: q.questionText,
          questionType: q.questionType,
          options: q.options,
          category: q.category,
          subject: q.subject,
          topic: q.topic,
          difficulty: q.difficulty,
          marks: q.marks,
          ...(isAnswered && {
            correctAnswer: q.correctAnswer,
            correctOptionIndex: q.correctOptionIndex,
            explanation: q.explanation,
          }),
        };
      });
    }

    res.status(200).json({
      success: true,
      data: sessionData,
    });
  } catch (error: unknown) {
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : String(error) });
  }
};

// Get bookmarked questions for the user
export const getBookmarks = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const user = await User.findById(userId).populate('bookmarkedQuestions');
    
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    // Format for frontend
    const questions = user.bookmarkedQuestions || [];
    
    res.status(200).json({
      success: true,
      data: questions,
    });
  } catch (error: unknown) {
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : String(error) });
  }
};

// Add a question to bookmarks
export const addBookmark = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { questionId } = req.params;

    const user = await User.findById(userId);
    
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    if (!user.bookmarkedQuestions) {
      user.bookmarkedQuestions = [];
    }

    if (!user.bookmarkedQuestions.includes(questionId as any)) {
      user.bookmarkedQuestions.push(questionId as any);
      await user.save();
    }

    res.status(200).json({
      success: true,
      message: 'Question bookmarked successfully',
    });
  } catch (error: unknown) {
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : String(error) });
  }
};

// Remove a question from bookmarks
export const removeBookmark = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { questionId } = req.params;

    const user = await User.findById(userId);
    
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    if (user.bookmarkedQuestions) {
      user.bookmarkedQuestions = user.bookmarkedQuestions.filter(
        (id: any) => id.toString() !== questionId
      );
      await user.save();
    }

    res.status(200).json({
      success: true,
      message: 'Question removed from bookmarks',
    });
  } catch (error: unknown) {
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : String(error) });
  }
};
