import { Request, Response } from 'express';
import { ExamSubmission } from '../models/exam-submission.model';
import { PracticeSession } from '../models/practice-session.model';
import { ExamPurchase } from '../models/exam-purchase.model';
import { Exam } from '../models/exam.model';

// GET /api/student/dashboard-stats - Get real dynamic stats & activity for student dashboard
export const getStudentDashboardStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    // 1. Fetch Exam Submissions
    const submissions = await ExamSubmission.find({ studentId: userId })
      .populate('examId', 'title category durationMinutes totalMarks passMarks')
      .sort({ submittedAt: -1 });

    const completedExamsCount = submissions.length;

    // Calculate Average Score
    let averageScore = 0;
    let totalExamSeconds = 0;
    if (completedExamsCount > 0) {
      const totalPercentage = submissions.reduce((acc, sub) => acc + (sub.percentage || 0), 0);
      averageScore = Math.round((totalPercentage / completedExamsCount) * 10) / 10;
      totalExamSeconds = submissions.reduce((acc, sub) => acc + (sub.timeTakenSeconds || 0), 0);
    }

    // 2. Fetch Practice Sessions
    const practiceSessions = await PracticeSession.find({ userId });
    const practiceSessionsCount = practiceSessions.length;

    let practiceSolved = 0;
    let totalPracticeSeconds = 0;
    practiceSessions.forEach((session) => {
      practiceSolved += session.answers ? session.answers.length : 0;
      totalPracticeSeconds += session.totalTimeSeconds || 0;
    });

    // 3. Active Study Time in Hours
    const totalSeconds = totalExamSeconds + totalPracticeSeconds;
    const activeStudyTimeHours = Math.round((totalSeconds / 3600) * 10) / 10;

    // 4. Fetch Purchased/Enrolled Exams
    const purchases = await ExamPurchase.find({ studentId: userId, status: 'completed' }).populate('examId');

    // 5. Recent Activity / Assessment Schedule
    const recentSubmissions = submissions.slice(0, 5).map((sub: any) => ({
      id: sub._id,
      title: sub.examId?.title || 'Exam Assessment',
      category: sub.examId?.category || 'General',
      score: sub.percentage,
      isPassed: sub.isPassed,
      completedAt: sub.submittedAt,
      type: 'exam_submission',
    }));

    res.status(200).json({
      success: true,
      data: {
        completedExams: completedExamsCount,
        averageScore,
        practiceSolved,
        practiceSessionsCount,
        activeStudyTimeHours,
        recentSubmissions,
        purchasedExamsCount: purchases.length,
      },
    });
  } catch (error: unknown) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch student dashboard statistics',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
