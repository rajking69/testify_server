import { Router, Request, Response } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import mongoose from 'mongoose';

const router = Router();

router.post('/sync-role', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || (req as any).user?._id;
    const { role } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (!role || !['student', 'teacher', 'admin'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role specified' });
    }

    const db = mongoose.connection.db;
    if (!db) {
      return res.status(500).json({ success: false, message: 'Database not connected' });
    }

    const query: any[] = [];
    if (mongoose.Types.ObjectId.isValid(String(userId))) {
      query.push({ _id: new mongoose.Types.ObjectId(String(userId)) });
    }
    query.push({ _id: String(userId) as any });

    const existingUser = await db.collection('user').findOne({ $or: query });

    if (!existingUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // STRICT ROLE IMMUTABILITY: Once a role is set in DB, it CANNOT be modified or switched to another role!
    if (existingUser.role && ['student', 'teacher', 'admin'].includes(existingUser.role)) {
      return res.status(200).json({
        success: true,
        message: `User role is permanently locked as ${existingUser.role}`,
        role: existingUser.role,
        locked: true,
      });
    }

    // First-time initial role assignment for new users
    await db.collection('user').updateOne(
      { $or: query },
      { $set: { role, updatedAt: new Date() } }
    );

    return res.status(200).json({
      success: true,
      message: `User role permanently assigned as ${role}`,
      role,
      locked: true,
    });
  } catch (error: any) {
    console.error('Error syncing user role:', error);
    return res.status(500).json({ success: false, message: error?.message || 'Failed to sync role' });
  }
});

export default router;
