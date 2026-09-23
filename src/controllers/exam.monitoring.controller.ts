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

    const attempts = await ExamAttempt.find({ examId }).sort({ updatedAt: -1 });
    const submissions = await ExamSubmission.find({ examId }).sort({ submittedAt: -1 });

    const now = Date.now();

    const liveCandidates = attempts.map((att: any) => {
      const remainingMs = Math.max(0, att.expiresAt.getTime() - now);
      const lastPingTime = att.proctoringData?.lastPingAt ? new Date(att.proctoringData.lastPingAt).getTime() : 0;
      const isOnline = lastPingTime > 0 && (now - lastPingTime < 35000);
      const sub = submissions.find(
        (s: any) =>
          s.studentId === att.studentId ||
          (s.studentEmail && att.studentEmail && s.studentEmail.toLowerCase() === att.studentEmail.toLowerCase())
      );

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

    const formatted = submissions.map((sub: any) => {
      const exam = teacherExams.find((e) => e._id.toString() === sub.examId.toString());
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