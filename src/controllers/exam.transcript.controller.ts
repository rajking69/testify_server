import { Request, Response } from 'express';
import { ExamSubmission } from '../models/exam-submission.model';
import { Exam } from '../models/exam.model';
import { calculateGrade } from '../utils/exam.utils';
import { logger } from '../lib/logger';

export const getSubmissionTranscript = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const submission = await ExamSubmission.findById(id);

    if (!submission) {
      logger.warn({ submissionId: id }, 'Submission transcript not found');
      res.status(404).json({ success: false, message: 'Submission transcript not found' });
      return;
    }

    const exam = await Exam.findById(submission.examId);
    const percentage = submission.percentage || (submission.totalMarks > 0 ? (submission.score / submission.totalMarks) * 100 : 0);
    const { grade, gradePoint } = calculateGrade(percentage);

    logger.info({ submissionId: id, examId: submission.examId }, 'Transcript fetched');
    res.status(200).json({
      success: true,
      data: {
        transcriptId: `TR-${submission._id.toString().slice(-8).toUpperCase()}`,
        student: {
          name: submission.studentName,
          email: submission.studentEmail,
          id: submission.studentId,
        },
        exam: {
          title: exam?.title || 'Academic Examination',
          category: exam?.category || 'General',
          subject: exam?.subject || 'Assessment',
          teacherName: exam?.teacherName || 'Instructor',
          durationMinutes: exam?.durationMinutes || 30,
        },
        results: {
          score: submission.score,
          totalMarks: submission.totalMarks,
          percentage: Number(percentage.toFixed(2)),
          grade,
          gradePoint,
          isPassed: submission.isPassed,
          timeTakenSeconds: submission.timeTakenSeconds || 0,
          submittedAt: submission.submittedAt,
        },
        answers: submission.answers,
        questions: exam?.questions || [],
      },
    });
  } catch (error) {
    logger.error({ error, submissionId: req.params.id }, 'Failed to fetch transcript');
    res.status(500).json({ success: false, message: 'Failed to fetch transcript', error });
  }
};