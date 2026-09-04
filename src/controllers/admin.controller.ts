import { Request, Response } from 'express';
import User from '../models/user.model';
import { Exam } from '../models/exam.model';
import { ExamSubmission } from '../models/exam-submission.model';
import { ExamPurchase } from '../models/exam-purchase.model';
import { UserSubscription } from '../models/subscription.model';
import FeatureFlag from '../models/feature-flag.model';
import SystemConfig from '../models/system-config.model';

// Admin Dashboard Overview
export const getDashboardOverview = async (req: Request, res: Response): Promise<void> => {
  try {
    const [totalUsers, totalExams, totalSubmissions, totalPurchases] = await Promise.all([
      User.countDocuments(),
      Exam.countDocuments(),
      ExamSubmission.countDocuments(),
      ExamPurchase.countDocuments(),
    ]);

    const activeSubscriptions = await UserSubscription.countDocuments({ status: 'active' });

    res.status(200).json({
      success: true,
      data: {
        totalUsers,
        totalExams,
        totalSubmissions,
        totalPurchases,
        activeSubscriptions,
      },
    });
  } catch (error: unknown) {
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : String(error) });
  }
};

// User Management
export const getAllUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { role, search, page = '1', limit = '10' } = req.query;

    const query: Record<string, unknown> = {};
    if (role) query.role = role;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    const [users, total] = await Promise.all([
      User.find(query).skip(skip).limit(limitNum).sort({ createdAt: -1 }),
      User.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      count: users.length,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      data: users,
    });
  } catch (error: unknown) {
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : String(error) });
  }
};

// Update User Role/Status
export const updateUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { role, status } = req.body;

    const user = await User.findByIdAndUpdate(
      id,
      { ...(role && { role }), ...(status && { status }) },
      { new: true }
    );

    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'User updated successfully',
      data: user,
    });
  } catch (error: unknown) {
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : String(error) });
  }
};

// Payments History (Purchases & Subscriptions)
export const getPayments = async (req: Request, res: Response): Promise<void> => {
  try {
    const [purchases, subscriptions] = await Promise.all([
      ExamPurchase.find().populate('userId', 'name email').populate('examId', 'title price'),
      UserSubscription.find().populate('planId', 'name price'),
    ]);

    res.status(200).json({
      success: true,
      data: {
        purchases,
        subscriptions,
      },
    });
  } catch (error: unknown) {
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : String(error) });
  }
};

// Feature Flags Management
export const getFeatureFlags = async (req: Request, res: Response): Promise<void> => {
  try {
    const flags = await FeatureFlag.find();
    res.status(200).json({ success: true, count: flags.length, data: flags });
  } catch (error: unknown) {
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : String(error) });
  }
};

export const toggleFeatureFlag = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const flag = await FeatureFlag.findById(id);

    if (!flag) {
      res.status(404).json({ success: false, message: 'Feature flag not found' });
      return;
    }

    flag.enabled = !flag.enabled;
    await flag.save();

    res.status(200).json({
      success: true,
      message: `Feature flag ${flag.enabled ? 'enabled' : 'disabled'}`,
      data: flag,
    });
  } catch (error: unknown) {
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : String(error) });
  }
};

// System Configurations
export const getSystemConfigs = async (req: Request, res: Response): Promise<void> => {
  try {
    const configs = await SystemConfig.find();
    res.status(200).json({ success: true, count: configs.length, data: configs });
  } catch (error: unknown) {
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : String(error) });
  }
};

export const updateSystemConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    const config = await SystemConfig.findOneAndUpdate(
      { key },
      { value },
      { new: true, upsert: true }
    );

    res.status(200).json({
      success: true,
      message: 'System configuration updated successfully',
      data: config,
    });
  } catch (error: unknown) {
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : String(error) });
  }
};
