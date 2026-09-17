import { Server, Socket } from 'socket.io';

let ioInstance: Server | null = null;

export const initNotificationSocket = (io: Server) => {
  ioInstance = io;

  io.on('connection', (socket: Socket) => {
    socket.on('join_user_room', (userId: string) => {
      if (userId) {
        socket.join(`user_${userId}`);
        console.log(`Socket ${socket.id} joined user room user_${userId}`);
      }
    });
  });
};

export const emitNotification = (userId: string, notification: any) => {
  if (ioInstance) {
    ioInstance.to(`user_${userId}`).emit('new_notification', notification);
  }
};
