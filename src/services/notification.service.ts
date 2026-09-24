import Notification, { INotification } from '../models/notification.model';
import { emitNotification } from '../sockets/notification.socket';

export const notificationService = {
  async createNotification(data: Partial<INotification>): Promise<INotification> {
    const notification = await Notification.create(data);
    
    // Emit real-time event
    if (notification.recipientId) {
      emitNotification(notification.recipientId, notification);
    }
    
    return notification;
  },

  async getUserNotifications(recipientId: string, limit = 50): Promise<INotification[]> {
    return Notification.find({ recipientId })
      .sort({ createdAt: -1 })
      .limit(limit);
  },

  async markAsRead(notificationId: string, recipientId: string): Promise<INotification | null> {
    return Notification.findOneAndUpdate(
      { _id: notificationId, recipientId },
      { readStatus: true },
      { new: true }
    );
  },

  async markAllAsRead(recipientId: string): Promise<void> {
    await Notification.updateMany(
      { recipientId, readStatus: false },
      { readStatus: true }
    );
  }
};
