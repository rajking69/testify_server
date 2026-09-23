import { Request, Response } from 'express';
import mongoose from 'mongoose';
import User from '../models/user.model';
import { Exam } from '../models/exam.model';
import { ExamSubmission } from '../models/exam-submission.model';
import { ExamPurchase } from '../models/exam-purchase.model';
import { UserSubscription } from '../models/subscription.model';
import FeatureFlag from '../models/feature-flag.model';
import SystemConfig from '../models/system-config.model';
import { logger } from '../lib/logger';

export const getDashboardOverview = async (req: Request, res: Response): Promise<void> => {
  try {
    const [totalUsers, totalExams, totalSubmissions, totalPurchases, purchaseRevAgg, subRevAgg] = await Promise.all([
      User.countDocuments(),
      Exam.countDocuments(),
      ExamSubmission.countDocuments(),
      ExamPurchase.countDocuments(),
      ExamPurchase.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$pricePaid' } } },
      ]),
      UserSubscription.aggregate([
        { $match: { status: 'active' } },
        { $group: { _id: null, total: { $sum: '$pricePaid' } } },
      ]),
    ]);

    const activeSubscriptions = await UserSubscription.countDocuments({ status: 'active' });
    const purchaseRevenue = purchaseRevAgg[0]?.total || 0;
    const subscriptionRevenue = subRevAgg[0]?.total || 0;
    const totalRevenue = purchaseRevenue + subscriptionRevenue;

    const platformFeeRate = 15;
    const platformFeeFromPurchases = Number((purchaseRevenue * (platformFeeRate / 100)).toFixed(2));
    const platformFeeFromSubscriptions = subscriptionRevenue;
    const totalPlatformFee = Number((platformFeeFromPurchases + platformFeeFromSubscriptions).toFixed(2));

    logger.info({ adminId: req.user?.id }, 'Admin dashboard overview fetched');
    res.status(200).json({
      success: true,
      data: {
        totalUsers,
        totalExams,
        totalSubmissions,
        totalPurchases,
        activeSubscriptions,
        totalRevenue,
        purchaseRevenue,
        subscriptionRevenue,
        platformFeeRate,
        platformFeeFromPurchases,
        platformFeeFromSubscriptions,
        totalPlatformFee,
      },
    });
  } catch (error) {
    logger.error({ error, adminId: req.user?.id }, 'Failed to fetch admin dashboard overview');
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : String(error) });
  }
};

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

    const formattedUsers = users.map((u: any) => {
      const obj = typeof u.toObject === 'function' ? u.toObject() : u;
      return {
        ...obj,
        id: obj._id ? obj._id.toString() : obj.id,
        avatarUrl: obj.avatarUrl || obj.image || '',
      };
    });

    logger.info({ adminId: req.user?.id, count: formattedUsers.length, total }, 'Admin users fetched');
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
  } catch (error) {
    logger.error({ error, adminId: req.user?.id }, 'Failed to fetch users');
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : String(error) });
  }
};

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
      logger.warn({ targetUserId: id, adminId: req.user?.id }, 'User not found for update');
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    const obj = typeof user.toObject === 'function' ? user.toObject() : user;
    const formattedUser = {
      ...obj,
      id: obj._id ? obj._id.toString() : obj.id,
      avatarUrl: obj.avatarUrl || obj.image || '',
    };

    logger.info({ targetUserId: id, adminId: req.user?.id, updates: updateFields }, 'User updated');
    res.status(200).json({
      success: true,
      message: 'User updated successfully',
      data: formattedUser,
    });
  } catch (error) {
    logger.error({ error, targetUserId: req.params.id, adminId: req.user?.id }, 'Failed to update user');
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : String(error) });
  }
};

export const deleteUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (req.user && req.user.id === id) {
      logger.warn({ adminId: req.user.id }, 'Admin attempted to delete own account');
      res.status(400).json({ success: false, message: 'You cannot delete your own admin account' });
      return;
    }

    let user = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      user = await User.findByIdAndDelete(id);
    } else {
      user = await User.findOneAndDelete({ _id: id });
    }

    if (!user) {
      logger.warn({ targetUserId: id, adminId: req.user?.id }, 'User not found for deletion');
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    if (mongoose.connection.db) {
      await Promise.allSettled([
        mongoose.connection.db.collection('session').deleteMany({ userId: id }),
        mongoose.connection.db.collection('account').deleteMany({ userId: id }),
      ]);
    }

    logger.info({ targetUserId: id, adminId: req.user?.id }, 'User deleted');
    res.status(200).json({
      success: true,
      message: 'User deleted successfully from database',
      data: { id },
    });
  } catch (error) {
    logger.error({ error, targetUserId: req.params.id, adminId: req.user?.id }, 'Failed to delete user');
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : String(error) });
  }
};