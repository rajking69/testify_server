import { Request, Response } from 'express';
import { Exam } from '../models/exam.model';
import { ExamPurchase } from '../models/exam-purchase.model';
import { logger } from '../lib/logger';

export const getTeacherRevenue = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({
        success: false,
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
      });
      return;
    }

    if (user.role !== 'teacher' && user.role !== 'admin') {
      res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: 'Access Denied: Only teachers and administrators can access revenue analytics.',
      });
      return;
    }

    const teacherId = user.id;
    const teacherEmail = user.email;
    const teacherEmailNorm = (teacherEmail || '').toLowerCase().trim();

    const teacherExams = await Exam.find({
      $or: [
        { teacherId: teacherId },
        { teacherEmail: teacherEmailNorm },
        { teacherEmail: teacherEmail },
        { teacherEmail: { $regex: new RegExp(`^${teacherEmailNorm.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}$`, 'i') } },
      ],
    });

    const teacherExamIds = teacherExams.map((e) => e._id);

    const purchases = await ExamPurchase.find({
      $or: [
        { teacherId: teacherId },
        { teacherEmail: teacherEmailNorm },
        { teacherEmail: teacherEmail },
        { teacherEmail: { $regex: new RegExp(`^${teacherEmailNorm.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}$`, 'i') } },
        { examId: { $in: teacherExamIds } },
      ],
      status: 'completed',
    }).sort({ createdAt: -1 });

    const seen = new Set<string>();
    const dedupedPurchases: typeof purchases = [];
    purchases.forEach((p: any) => {
      const key = (p.transactionId || p._id.toString()).toString();
      if (!seen.has(key)) {
        seen.add(key);
        dedupedPurchases.push(p);
      }
    });

    const grossRevenue = dedupedPurchases.reduce((sum: number, p: any) => sum + (p.pricePaid || 0), 0);
    const platformFeePercentage = 40;
    const platformFees = (grossRevenue * platformFeePercentage) / 100;
    const teacherEarnings = grossRevenue - platformFees;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const todayPurchases = dedupedPurchases.filter((p: any) => new Date(p.createdAt) >= startOfToday);
    const monthPurchases = dedupedPurchases.filter((p: any) => new Date(p.createdAt) >= startOfMonth);

    const todayGrossRevenue = todayPurchases.reduce((sum: number, p: any) => sum + (p.pricePaid || 0), 0);
    const todayNetEarnings = todayGrossRevenue * (1 - platformFeePercentage / 100);

    const monthGrossRevenue = monthPurchases.reduce((sum: number, p: any) => sum + (p.pricePaid || 0), 0);
    const monthNetEarnings = monthGrossRevenue * (1 - platformFeePercentage / 100);

    const examMap = new Map<string, { examTitle: string; unitPrice: number; count: number; gross: number }>();

    dedupedPurchases.forEach((p: any) => {
      const eId = p.examId.toString();
      const existing = examMap.get(eId);
      if (existing) {
        existing.count += 1;
        existing.gross += p.pricePaid || 0;
      } else {
        const foundExam = teacherExams.find((e: any) => e._id.toString() === eId);
        examMap.set(eId, {
          examTitle: foundExam?.title || 'Monetized Examination',
          unitPrice: p.pricePaid || foundExam?.price || 0,
          count: 1,
          gross: p.pricePaid || 0,
        });
      }
    });

    teacherExams.forEach((e: any) => {
      const eId = e._id.toString();
      if (!examMap.has(eId) && (e.price > 0 || e.accessType === 'paid' || e.accessType === 'subscription_only')) {
        examMap.set(eId, {
          examTitle: e.title,
          unitPrice: e.price || 0,
          count: 0,
          gross: 0,
        });
      }
    });

    const examBreakdown = Array.from(examMap.entries()).map(([examId, item]) => {
      const pFee = (item.gross * platformFeePercentage) / 100;
      return {
        examId,
        examTitle: item.examTitle,
        unitPrice: item.unitPrice,
        soldCount: item.count,
        grossRevenue: item.gross,
        platformFee: pFee,
        netEarnings: item.gross - pFee,
        status: item.count > 0 ? 'ACTIVE SALES' : 'MONETIZED',
      };
    });

    const recentTransactions = dedupedPurchases.map((p: any) => ({
      id: p._id.toString(),
      studentId: p.studentId,
      studentName: p.studentName || 'Student Scholar',
      studentEmail: p.studentEmail,
      examId: p.examId.toString(),
      examTitle: examMap.get(p.examId.toString())?.examTitle || 'Certified Paid Exam',
      teacherId: p.teacherId,
      amount: p.pricePaid,
      currency: 'USD',
      paymentProvider: p.paymentProvider || 'STRIPE',
      transactionId: p.transactionId || `TXN-${p._id.toString().slice(-8)}`,
      paymentStatus: p.status === 'completed' ? 'SUCCESS' : p.status.toUpperCase(),
      purchasedAt: p.createdAt.toISOString(),
      accessStatus: 'ACTIVE',
    }));

    logger.info({ teacherId, salesCount: dedupedPurchases.length, grossRevenue }, 'Teacher revenue fetched');
    res.status(200).json({
      success: true,
      data: {
        paidExamsCount: Array.from(examMap.keys()).length,
        totalSalesCount: dedupedPurchases.length,
        grossRevenue,
        platformFeePercentage,
        platformFees,
        teacherEarnings,
        todayGrossRevenue,
        todayNetEarnings,
        monthGrossRevenue,
        monthNetEarnings,
        pendingBalance: teacherEarnings,
        paidBalance: 0,
        examBreakdown,
        recentTransactions,
      },
    });
  } catch (error) {
    logger.error({ error, teacherId: req.user?.id }, 'Error fetching teacher revenue');
    res.status(500).json({
      success: false,
      message: 'Failed to fetch teacher revenue summary',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};