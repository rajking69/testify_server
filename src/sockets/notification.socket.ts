import { Server, Socket } from 'socket.io';
import { auth } from '../lib/auth';
import { fromNodeHeaders } from 'better-auth/node';

let ioInstance: Server | null = null;

async function verifySocketAuth(socket: Socket): Promise<{ userId: string; email: string; role: string } | null> {
  try {
    const headers = socket.handshake.headers;
    const cookieHeader = headers.cookie;

    if (!cookieHeader) {
      return null;
    }

    const session = await auth.api.getSession({
      headers: fromNodeHeaders({
        cookie: cookieHeader,
      }),
    });

    if (!session?.user) {
      return null;
    }

    return {
      userId: session.user.id,
      email: session.user.email,
      role: session.user.role || 'student',
    };
  } catch (error) {
    console.error('[Socket Auth] Verification failed:', error);
    return null;
  }
}

export const initNotificationSocket = (io: Server) => {
  ioInstance = io;

  // Authentication middleware
  io.use(async (socket, next) => {
    const authData = await verifySocketAuth(socket);
    if (!authData) {
      return next(new Error('Authentication required'));
    }
    socket.data.user = authData;
    next();
  });

  io.on('connection', (socket: Socket) => {
    const user = socket.data.user;
    
    socket.on('join_user_room', () => {
      // Use authenticated user ID instead of trusting client-provided ID
      socket.join(`user_${user.userId}`);
      console.log(`Socket ${socket.id} joined user room user_${user.userId} (role: ${user.role})`);
    });
  });
};

export const emitNotification = (userId: string, notification: any) => {
  if (ioInstance) {
    ioInstance.to(`user_${userId}`).emit('new_notification', notification);
  }
};
