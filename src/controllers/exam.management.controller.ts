import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { Exam } from '../models/exam.model';
import { ExamAttempt } from '../models/exam-attempt.model';
import { formatExamResponse } from '../utils/exam.utils';
import { logger } from '../lib/logger';

const formatQuestions = (questions: any[]) => {
  if (!Array.isArray(questions)) return [];
  return questions.map((q: any, idx: number) => ({
    id: String(q.id || q._id || `q_${Date.now()}_${idx}`),
    questionText: q.questionText || q.question || '',
    options: Array.isArray(q.options) ? q.options : [],
    correctOptionIndex: typeof q.correctOptionIndex === 'number' ? q.correctOptionIndex : 0,
    correctAnswer: String(q.correctAnswer || ''),
    marks: Number(q.marks) || 1,
    explanation: q.explanation || '',
  }));
};

export const createExam = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const {
      title,
      description = '',
      category = 'General',
      subject,
      scheduleType = 'flexible',
      startDateTime,
      endDateTime,
      date,
      accessType = 'free',
      status = 'published',
      price = 0,
      durationMinutes = 30,
      totalMarks = 100,
      passMarks,
      passMark,
      passPercentage = 40,
      questions = [],
      isPublished,
      joinCode,
      accessToken,
      schedule,
      requireCamera,
    } = req.body;

    if (!title || !title.trim()) {
      logger.warn({ userId: user.id }, 'Exam creation failed: title required');
      res.status(400).json({
        success: false,
        code: 'INVALID_INPUT',
        message: 'Exam title is required',
      });
      return;
    }

    const chosenAccessType = String(accessType || 'free').toLowerCase() as 'free' | 'paid' | 'subscription_only';
    const chosenStatus = String(status || 'published').toLowerCase() as 'draft' | 'published' | 'scheduled';
    const computedIsPublished = isPublished !== undefined ? Boolean(isPublished) : chosenStatus !== 'draft';
    const totalM = Number(totalMarks) || 100;
    const computedPassMarks = Number(passMarks || passMark || Math.round((totalM * (Number(passPercentage) || 40)) / 100)) || 40;
    const chosenSubject = String(subject || category || 'General').trim();
    const chosenScheduleType = String(scheduleType || 'flexible').toLowerCase() === 'scheduled' ? 'scheduled' : 'flexible';

    const formattedQuestions = formatQuestions(questions);

    const newExam = await Exam.create({
      title: title.trim(),
      description: description.trim(),
      category: chosenSubject,
      subject: chosenSubject,
      scheduleType: chosenScheduleType,
      startDateTime,
      endDateTime,
      date: date || (startDateTime ? new Date(startDateTime).toLocaleString() : undefined),
      joinCode: (joinCode || Math.random().toString(36).substring(2, 8)).toUpperCase(),
      accessToken: accessToken || ('tst_' + Math.random().toString(36).substring(2, 12)),
      teacherId: user.id,
      teacherName: user.name || 'Instructor',
      teacherEmail: user.email,
      accessType: chosenAccessType,
      status: chosenStatus,
      price: chosenAccessType === 'paid' ? Number(price) || 0 : 0,
      durationMinutes: Number(durationMinutes) || 30,
      totalMarks: totalM,
      passMarks: computedPassMarks,
      questions: formattedQuestions,
      isPublished: computedIsPublished,
      schedule: schedule || undefined,
      requireCamera: Boolean(requireCamera),
    });

    logger.info({ examId: newExam._id, teacherId: user.id, title: newExam.title }, 'Exam created');
    res.status(201).json({
      success: true,
      message: 'Exam created successfully',
      data: newExam,
    });
  } catch (error) {
    logger.error({ error, userId: req.user?.id }, 'Failed to create exam');
    res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Failed to create exam',
      error: error instanceof Error ? error.message : error,
    });
  }
};

export const updateExam = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const user = req.user!;
    const cleanId = (id || '').trim();

    let exam = null;
    if (mongoose.isValidObjectId(cleanId)) {
      exam = await Exam.findById(cleanId);
    }
    if (!exam) {
      exam = await Exam.findOne({
        $or: [
          { joinCode: cleanId.toUpperCase() },
          { joinCode: cleanId },
          { accessToken: cleanId },
        ],
      });
    }

    if (!exam) {
      logger.warn({ examId: cleanId, userId: user.id }, 'Exam not found for update');
      res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Exam not found',
      });
      return;
    }

    const isCreator =
      exam.teacherId === user.id || (exam.teacherEmail && exam.teacherEmail === user.email);
    const isAdmin = user.role === 'admin';

    if (!isCreator && !isAdmin) {
      logger.warn({ examId: exam._id, userId: user.id, role: user.role }, 'Unauthorized exam update attempt');
      res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: "You are not authorized to update another teacher's examination.",
      });
      return;
    }

    const {
      title,
      description,
      category,
      subject,
      accessType,
      status,
      price,
      durationMinutes,
      totalMarks,
      passMarks,
      passMark,
      passPercentage,
      questions,
      isPublished,
      joinCode,
      accessToken,
      schedule,
      startDateTime,
      endDateTime,
      date,
    } = req.body;

    if (title !== undefined) exam.title = String(title).trim();
    if (description !== undefined) exam.description = String(description).trim();
    if (subject !== undefined || category !== undefined) {
      const s = String(subject || category || exam.subject || exam.category).trim();
      exam.subject = s;
      exam.category = s;
    }
    if (accessType !== undefined) {
      const a = String(accessType).toLowerCase() as 'free' | 'paid' | 'subscription_only';
      exam.accessType = a;
      if (a !== 'paid') exam.price = 0;
    }
    if (price !== undefined && exam.accessType === 'paid') {
      exam.price = Number(price) || 0;
    }
    if (durationMinutes !== undefined) exam.durationMinutes = Number(durationMinutes) || 30;
    if (totalMarks !== undefined) exam.totalMarks = Number(totalMarks) || 100;
    if (passMarks !== undefined || passMark !== undefined || passPercentage !== undefined) {
      exam.passMarks = Number(passMarks || passMark || Math.round((exam.totalMarks * (Number(passPercentage) || 40)) / 100)) || 40;
    }
    if (status !== undefined) {
      const st = String(status).toLowerCase() as 'draft' | 'published' | 'scheduled';
      exam.status = st;
      exam.isPublished = st !== 'draft';
    } else if (isPublished !== undefined) {
      exam.isPublished = Boolean(isPublished);
      exam.status = exam.isPublished ? 'published' : 'draft';
    }
    if (joinCode !== undefined) exam.joinCode = joinCode;
    if (accessToken !== undefined) exam.accessToken = accessToken;
    if (req.body.scheduleType !== undefined) (exam as any).scheduleType = req.body.scheduleType === 'scheduled' ? 'scheduled' : 'flexible';
    if (startDateTime !== undefined) (exam as any).startDateTime = startDateTime;
    if (endDateTime !== undefined) (exam as any).endDateTime = endDateTime;
    if (date !== undefined) (exam as any).date = date;
    if (schedule !== undefined) exam.schedule = schedule;
    if (req.body.requireCamera !== undefined) exam.requireCamera = Boolean(req.body.requireCamera);

    if (Array.isArray(questions)) {
      exam.questions = formatQuestions(questions);
    }

    await exam.save();

    logger.info({ examId: exam._id, teacherId: user.id }, 'Exam updated');
    res.status(200).json({
      success: true,
      message: 'Exam updated successfully',
      data: exam,
    });
  } catch (error) {
    logger.error({ error, examId: req.params.id, userId: req.user?.id }, 'Failed to update exam');
    res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Failed to update exam',
      error: error instanceof Error ? error.message : error,
    });
  }
};

export const deleteExam = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const user = req.user!;
    const cleanId = (id || '').trim();

    let exam = null;
    if (mongoose.isValidObjectId(cleanId)) {
      exam = await Exam.findById(cleanId);
    }
    if (!exam) {
      exam = await Exam.findOne({
        $or: [
          { joinCode: cleanId.toUpperCase() },
          { joinCode: cleanId },
          { accessToken: cleanId },
        ],
      });
    }

    if (!exam) {
      logger.warn({ examId: id }, 'Exam not found for deletion');
      res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Exam not found',
      });
      return;
    }

    const isCreator =
      exam.teacherId === user.id ||
      (exam.teacherEmail && exam.teacherEmail.toLowerCase() === user.email.toLowerCase());
    const isAdmin = user.role === 'admin';

    if (!isCreator && !isAdmin) {
      logger.warn({ examId: id, userId: user.id, role: user.role }, 'Unauthorized exam deletion attempt');
      res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: "You are not authorized to delete another teacher's examination.",
      });
      return;
    }

    // Option A: hard delete exam + attempts, preserve purchases/submissions for audit
    await Promise.all([
      ExamAttempt.deleteMany({ examId: exam._id }),
      Exam.findByIdAndDelete(exam._id),
    ]);

    logger.info({ examId: exam._id, teacherId: user.id }, 'Exam deleted (attempts cleaned, purchases/submissions preserved)');
    res.status(200).json({
      success: true,
      message: 'Exam deleted successfully',
      data: { id },
    });
  } catch (error) {
    logger.error({ error, examId: req.params.id, userId: req.user?.id }, 'Failed to delete exam');
    res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Failed to delete exam',
      error: error instanceof Error ? error.message : error,
    });
  }
};