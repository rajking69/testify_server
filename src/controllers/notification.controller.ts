import { Request, Response } from 'express';
import { notificationService } from '../services/notification.service';

export const notificationController = {
  async getUserNotifications(req: Request, res: Response) {
    try {
      // Assuming req.user is set by auth middleware
      const userId = (req as any).user?.id || (req as any).user?._id;
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const notifications = await notificationService.getUserNotifications(userId, limit);

      return res.status(200).json({ success: true, data: notifications });
    } catch (error: any) {
      console.error('Error fetching notifications:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  async markAsRead(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id || (req as any).user?._id;
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const { id } = req.params;
      const notification = await notificationService.markAsRead(id, userId);

      if (!notification) {
        return res.status(404).json({ success: false, message: 'Notification not found' });
      }

      return res.status(200).json({ success: true, data: notification });
    } catch (error: any) {
      console.error('Error marking notification as read:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  async markAllAsRead(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id || (req as any).user?._id;
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      await notificationService.markAllAsRead(userId);

      return res.status(200).json({ success: true, message: 'All notifications marked as read' });
    } catch (error: any) {
      console.error('Error marking all notifications as read:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
};
