import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { Exam } from '../models/exam.model';
import { ExamPurchase } from '../models/exam-purchase.model';
import { ExamSubmission } from '../models/exam-submission.model';
import { UserSubscription } from '../models/subscription.model';
import { formatExamResponse, formatExamListResponse } from '../utils/exam.utils';
import { logger } from '../lib/logger';

// Escape user input for safe use in RegExp
function escapeRegExp(input: string): string {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const getPublicExams = async (req: Request, res: Response): Promise<void> => {
  try {
    const { category, search } = req.query;
    const filter: any = {
      isPublished: true,
      status: { $ne: 'draft' },
    };

    if (category && category !== 'all' && category !== 'All') {
      const safeCategory = escapeRegExp(String(category));
      filter.$or = [
        { category: new RegExp(`^${safeCategory}$`, 'i') },
        { subject: new RegExp(`^${safeCategory}$`, 'i') },
      ];
    }

    if (search) {
      const safeSearch = escapeRegExp(String(search));
      filter.title = { $regex: safeSearch, $options: 'i' };
    }

    const exams = await Exam.find(filter)
      .select('-questions.correctOptionIndex -questions.explanation')
      .sort({ createdAt: -1 })
      .lean();

    const mappedExams = exams.map((exam: any) => formatExamResponse(exam, true, false));

    logger.info({ count: mappedExams.length, category, search }, 'Public exams fetched');

    res.status(200).json({
      success: true,
      count: mappedExams.length,
      data: mappedExams,
    });
  } catch (error) {
    logger.error({ error, category: req.query.category, search: req.query.search }, 'Failed to fetch public exams');
    res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Failed to fetch public exams',
      error: error instanceof Error ? error.message : error,
    });
  }
};

export const getAllExams = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    const { category, subject, accessType, teacherId, teacherEmail, mine, isPublished, search } = req.query;

    const filter: any = {};

    if (mine === 'true' && user) {
      const emailRegex = user.email ? new RegExp(`^${user.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') : null;
      filter.$or = [
        { teacherId: user.id },
        { teacherEmail: user.email },
        ...(emailRegex ? [{ teacherEmail: emailRegex }, { creatorEmail: emailRegex }, { createdBy: emailRegex }] : []),
      ];
    } else if (teacherId) {
      if (user && (user.id === teacherId || user.role === 'admin')) {
        filter.teacherId = teacherId;
      } else {
        filter.teacherId = teacherId;
        filter.isPublished = { $ne: false };
      }
    } else if (teacherEmail) {
      if (user && (user.email === teacherEmail || user.role === 'admin')) {
        filter.teacherEmail = teacherEmail;
      } else {
        filter.teacherEmail = teacherEmail;
        filter.isPublished = { $ne: false };
      }
    } else if (isPublished !== undefined && user && user.role === 'admin') {
      filter.isPublished = isPublished === 'true';
    } else if (!user || user.role === 'student') {
      filter.isPublished = { $ne: false };
    } else if (user.role === 'teacher') {
      const emailRegex = user.email ? new RegExp(`^${user.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') : null;
      filter.$or = [
        { isPublished: { $ne: false } },
        { teacherId: user.id },
        { teacherEmail: user.email },
        ...(emailRegex ? [{ teacherEmail: emailRegex }, { creatorEmail: emailRegex }, { createdBy: emailRegex }] : []),
      ];
    }

    const cat = category || subject;
    if (cat && cat !== 'all' && cat !== 'All') {
      const safeCat = escapeRegExp(String(cat));
      const catRegex = new RegExp(`^${safeCat}$`, 'i');
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [{ category: catRegex }, { subject: catRegex }],
      });
    }

    if (accessType && accessType !== 'all' && accessType !== 'All') {
      filter.accessType = String(accessType).toLowerCase();
    }

    if (search) {
      const safeSearch = escapeRegExp(String(search));
      const searchRegex = new RegExp(safeSearch, 'i');
      const searchOr = [{ title: searchRegex }, { description: searchRegex }, { category: searchRegex }, { subject: searchRegex }];
      if (filter.$or) {
        filter.$and = filter.$and || [];
        filter.$and.push({ $or: filter.$or }, { $or: searchOr });
        delete filter.$or;
      } else {
        filter.$or = searchOr;
      }
    }

    const exams = await Exam.find(filter)
      .select('-questions.correctOptionIndex -questions.explanation')
      .sort({ createdAt: -1 })
      .lean();

    if (!user) {
      const mappedExams = exams.map((exam: any) => formatExamResponse(exam, false, false));
      logger.info({ count: mappedExams.length }, 'All exams fetched (unauthenticated)');
      res.status(200).json({
        success: true,
        count: mappedExams.length,
        data: mappedExams,
      });
      return;
    }

    if (user.role === 'student') {
      const now = new Date();
      const activeSubscription = await UserSubscription.findOne({
        userId: user.id,
        role: 'student',
        status: 'active',
        endDate: { $gt: now },
      });

      const purchases = await ExamPurchase.find({
        studentId: user.id,
        status: 'completed',
      }).select('examId');

      const purchasedExamIds = new Set(purchases.map((p) => p.examId.toString()));

      const submissions = await ExamSubmission.find({
        $or: [{ studentId: user.id }, { studentEmail: user.email }],
      }).select('examId');

      const submittedExamIds = new Set(submissions.map((s) => s.examId.toString()));

      const mappedExams = exams.map((exam: any) => {
        const examIdStr = exam._id.toString();
        const isUnlocked =
          exam.accessType === 'free' ||
          Boolean(activeSubscription) ||
          purchasedExamIds.has(examIdStr);

        return {
          ...formatExamResponse(exam, false, false),
          id: examIdStr,
          examId: examIdStr,
          isUnlocked,
          isCompleted: submittedExamIds.has(examIdStr),
        };
      });

      logger.info({ userId: user.id, count: mappedExams.length }, 'Student exams fetched');
      res.status(200).json({
        success: true,
        count: mappedExams.length,
        data: mappedExams,
      });
      return;
    }

    const mappedExams = exams.map((exam: any) => ({
      ...formatExamResponse(exam, false, false),
      id: exam._id.toString(),
      examId: exam._id.toString(),
      isUnlocked: true,
    }));

    logger.info({ userId: user.id, role: user.role, count: mappedExams.length }, 'Teacher/Admin exams fetched');
    res.status(200).json({
      success: true,
      count: mappedExams.length,
      data: mappedExams,
    });
  } catch (error) {
    logger.error({ error, userId: req.user?.id }, 'Failed to fetch exams');
    res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Failed to fetch exams',
      error: error instanceof Error ? error.message : error,
    });
  }
};

export const getExamById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const user = req.user;
    const cleanId = (id || '').trim();

    let exam = null;
    const mongoose = (await import('mongoose')).default;

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
      logger.warn({ examId: cleanId }, 'Exam not found');
      res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Exam not found',
      });
      return;
    }

    const isCreator = Boolean(
      user &&
      (exam.teacherId === user.id || (exam.teacherEmail && exam.teacherEmail === user.email))
    );
    const isAdmin = Boolean(user && user.role === 'admin');
    const isCreatorOrAdmin = isCreator || isAdmin;

    if ((exam.isPublished === false || String((exam as any).status).toLowerCase() === 'draft') && !isCreatorOrAdmin) {
      logger.warn({ examId: cleanId, userId: user?.id }, 'Unauthorized access to draft exam');
      res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Exam not found or is not currently published.',
      });
      return;
    }

    let existingSubmission = null;
    if (user) {
      existingSubmission = await ExamSubmission.findOne({
        examId: exam._id,
        $or: [{ studentId: user.id }, { studentEmail: user.email }],
      });
    }

    const examData: any = exam.toObject();
    examData.id = exam._id.toString();
    examData.examId = exam._id.toString();
    examData.duration = exam.durationMinutes;
    examData.joinCode = (exam as any).joinCode;
    examData.accessToken = (exam as any).accessToken;
    examData.startDateTime = (exam as any).startDateTime;
    examData.endDateTime = (exam as any).endDateTime;
    examData.subject = exam.subject || exam.category || 'General';
    examData.status = exam.status || (exam.isPublished ? 'published' : 'draft');
    examData.enrolledCount = exam.totalEnrolled || 0;
    examData.completedCount = exam.completedCount || 0;
    examData.passMark = exam.passMarks;
    examData.teacherName = exam.teacherName;
    examData.createdBy = exam.teacherName;
    if (!isCreatorOrAdmin && examData.questions) {
      examData.questions = examData.questions.map((q: any) => ({
        _id: q._id || q.id,
        id: q.id || q._id,
        questionText: q.questionText,
        options: q.options,
        marks: q.marks,
      }));
    }

    examData.isCompleted = Boolean(existingSubmission);

    logger.info({ examId: exam._id, userId: user?.id }, 'Exam details fetched');
    res.status(200).json({
      success: true,
      data: examData,
    });
  } catch (error) {
    logger.error({ error, examId: req.params.id }, 'Failed to fetch exam details');
    res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Failed to fetch exam details',
      error: error instanceof Error ? error.message : error,
    });
  }
};