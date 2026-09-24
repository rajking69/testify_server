import { Request, Response } from 'express';
import { Exam } from '../models/exam.model';
import { ExamAttempt } from '../models/exam-attempt.model';
import { ExamSubmission } from '../models/exam-submission.model';
import { logger } from '../lib/logger';

export const getLiveMonitoringData = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { examId } = req.params;

    const exam = await Exam.findById(examId);
    if (!exam) {
      logger.warn({ examId, teacherId: user.id }, 'Exam not found for live monitoring');
      res.status(404).json({ success: false, message: 'Exam not found' });
      return;
    }

    // P0: Authorization — only owner or admin can monitor
    const isCreator = exam.teacherId === user.id || (exam.teacherEmail && exam.teacherEmail.toLowerCase() === user.email.toLowerCase());
    const isAdmin = user.role === 'admin';
    if (!isCreator && !isAdmin) {
      logger.warn({ examId, teacherId: user.id, role: user.role }, 'Unauthorized live monitoring access');
      res.status(403).json({ success: false, code: 'FORBIDDEN', message: "You are not authorized to monitor this examination." });
      return;
    }

    const attempts = await ExamAttempt.find({ examId }).sort({ updatedAt: -1 });
    const submissions = await ExamSubmission.find({ examId }).sort({ submittedAt: -1 });

    // P3: O(1) lookup for submissions
    const submissionMap = new Map<string, any>();
    for (const s of submissions as any[]) {
      const k1 = String(s.studentId || '').toLowerCase();
      const k2 = String(s.studentEmail || '').toLowerCase();
      if (k1) submissionMap.set(k1, s);
      if (k2) submissionMap.set(`email:${k2}`, s);
    }

    const now = Date.now();

    const liveCandidates = attempts.map((att: any) => {
      const remainingMs = Math.max(0, att.expiresAt.getTime() - now);
      const lastPingTime = att.proctoringData?.lastPingAt ? new Date(att.proctoringData.lastPingAt).getTime() : 0;
      const isOnline = lastPingTime > 0 && (now - lastPingTime < 35000);
      const sub = submissionMap.get(String(att.studentId || '').toLowerCase()) || submissionMap.get(`email:${String(att.studentEmail || '').toLowerCase()}`);

      return {
        attemptId: att._id,
        studentId: att.studentId,
        name: att.studentName,
        email: att.studentEmail,
        startedAt: att.startedAt,
        expiresAt: att.expiresAt,
        remainingSeconds: Math.floor(remainingMs / 1000),
        status: sub ? 'Completed' : (remainingMs <= 0 || att.status === 'expired' ? 'Expired' : 'In Progress'),
        isOnline: sub ? false : isOnline,
        progress: {
          answered: att.proctoringData?.answersCount || 0,
          total: exam.questions.length,
          currentQuestion: (att.proctoringData?.currentQuestionIndex || 0) + 1,
        },
        proctoring: {
          cameraActive: att.proctoringData?.cameraActive ?? true,
          faceDetected: att.proctoringData?.faceDetected ?? true,
          tabSwitchCount: att.proctoringData?.tabSwitchCount || 0,
        },
        score: sub ? sub.score : null,
        percentage: sub ? sub.percentage : null,
        isPassed: sub ? sub.isPassed : null,
      };
    });

    logger.info({ examId, teacherId: user.id, candidates: liveCandidates.length }, 'Live monitoring data fetched');
    res.status(200).json({
      success: true,
      data: {
        examId: exam._id,
        examTitle: exam.title,
        totalQuestions: exam.questions.length,
        durationMinutes: exam.durationMinutes,
        totalAttempts: attempts.length,
        totalSubmissions: submissions.length,
        activeNow: liveCandidates.filter((c: any) => c.status === 'In Progress' && c.isOnline).length,
        candidates: liveCandidates,
      },
    });
  } catch (error) {
    logger.error({ error, examId: req.params.examId, userId: req.user?.id }, 'Failed to fetch live monitoring data');
    res.status(500).json({ success: false, message: 'Failed to fetch live monitoring data', error });
  }
};

export const getTeacherExamsSubmissions = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const teacherExams = await Exam.find({
      $or: [{ teacherId: user.id }, { teacherEmail: user.email }],
    });

    const examIds = teacherExams.map((e) => e._id);
    const submissions = await ExamSubmission.find({ examId: { $in: examIds } }).sort({ submittedAt: -1 });

    const examMap = new Map<string, any>();
    for (const e of teacherExams as any[]) examMap.set(e._id.toString(), e);
    const formatted = submissions.map((sub: any) => {
      const exam = examMap.get(sub.examId.toString());
      return {
        id: sub._id,
        submissionId: sub._id,
        examId: sub.examId,
        studentId: sub.studentId,
        studentName: sub.studentName,
        studentEmail: sub.studentEmail,
        examTitle: exam?.title || 'Examination',
        subject: exam?.subject || 'Assessment',
        category: exam?.category || 'General',
        score: sub.score,
        totalMarks: sub.totalMarks,
        percentage: sub.percentage,
        grade: sub.grade || (sub.percentage >= 80 ? 'A+' : sub.percentage >= 70 ? 'A' : sub.percentage >= 60 ? 'B' : sub.percentage >= 50 ? 'C' : 'F'),
        gradePoint: sub.gradePoint || (sub.percentage >= 80 ? 4.0 : sub.percentage >= 70 ? 3.5 : sub.percentage >= 60 ? 3.0 : sub.percentage >= 50 ? 2.0 : 0.0),
        isPassed: sub.isPassed,
        timeTakenSeconds: sub.timeTakenSeconds || 0,
        submittedAt: sub.submittedAt,
      };
    });

    logger.info({ teacherId: user.id, count: formatted.length }, 'Teacher exam submissions fetched');
    res.status(200).json({
      success: true,
      count: formatted.length,
      data: formatted,
    });
  } catch (error) {
    logger.error({ error, userId: req.user?.id }, 'Failed to fetch teacher submissions');
    res.status(500).json({ success: false, message: 'Failed to fetch teacher submissions', error });
  }
};