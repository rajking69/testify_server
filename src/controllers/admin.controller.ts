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
    const { role, search, status, page, limit } = req.query;

    const query: Record<string, unknown> = {};
    if (role && role !== 'all') {
      query.role = role;
    }
    if (status && status !== 'all') {
      if (status === 'deactivated') {
        query.status = { $in: ['deactivated', 'inactive'] };
      } else {
        query.status = status;
      }
    }
    if (search && typeof search === 'string' && search.trim()) {
      const searchRegex = { $regex: search.trim(), $options: 'i' };
      query.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { department: searchRegex },
      ];
    }

    const total = await User.countDocuments(query);

    // Compute global user statistics across the whole collection for stat cards and tab badges
    const [totalUsers, activeUsers, suspendedUsers, deactivatedUsers, teacherCount, studentCount, adminCount] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ status: 'active' }),
      User.countDocuments({ status: 'suspended' }),
      User.countDocuments({ status: { $in: ['deactivated', 'inactive'] } }),
      User.countDocuments({ role: 'teacher' }),
      User.countDocuments({ role: 'student' }),
      User.countDocuments({ role: 'admin' }),
    ]);

    let userQuery = User.find(query).sort({ createdAt: -1 });

    const isAll = limit === 'all' || limit === '0' || (!limit && !page);
    let pageNum = 1;
    let limitNum = total;
    let totalPages = 1;

    if (!isAll) {
      pageNum = Math.max(1, parseInt((page as string) || '1', 10));
      limitNum = Math.max(1, parseInt((limit as string) || '10', 10));
      const skip = (pageNum - 1) * limitNum;
      userQuery = userQuery.skip(skip).limit(limitNum);
      totalPages = Math.ceil(total / limitNum) || 1;
    }

    const users = await userQuery;

    const formattedUsers = users.map((u) => {
      const obj = typeof u.toObject === 'function' ? u.toObject() : u;
      return {
        ...obj,
        id: obj._id ? obj._id.toString() : obj.id,
        avatarUrl: obj.avatarUrl || obj.image || '',
      };
    });

    res.status(200).json({
      success: true,
      count: formattedUsers.length,
      total,
      page: pageNum,
      totalPages,
      stats: {
        total: totalUsers,
        active: activeUsers,
        suspended: suspendedUsers,
        deactivated: deactivatedUsers,
        teachers: teacherCount,
        students: studentCount,
        admins: adminCount,
      },
      data: formattedUsers,
    });
  } catch (error: unknown) {
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : String(error) });
  }
};

// Update User Role/Status
export const updateUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { role, status, department } = req.body;

    const updateFields: Record<string, unknown> = {};
    if (role) updateFields.role = role;
    if (status) updateFields.status = status;
    if (department !== undefined) updateFields.department = department;

    const user = await User.findByIdAndUpdate(
      id,
      updateFields,
      { new: true }
    );

    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    const obj = typeof user.toObject === 'function' ? user.toObject() : user;
    const formattedUser = {
      ...obj,
      id: obj._id ? obj._id.toString() : obj.id,
      avatarUrl: obj.avatarUrl || obj.image || '',
    };

    res.status(200).json({
      success: true,
      message: 'User updated successfully',
      data: formattedUser,
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
