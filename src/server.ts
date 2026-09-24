import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import app, { setSocketIOInstance } from './app';
import { connectDB } from './config/db';
import { env } from './config/env';
import { initMonitoringSocket } from './sockets/monitoring.socket';
import { initNotificationSocket } from './sockets/notification.socket';

async function startServer(): Promise<void> {
  try {
    // 1. Connect to MongoDB Atlas
    await connectDB();

    // 2. Create HTTP Server wrapping Express app
    const httpServer = http.createServer(app);

    // 3. Attach Socket.IO Server with CORS
    const io = new SocketIOServer(httpServer, {
      cors: {
        origin: (origin, callback) => {
          callback(null, true);
        },
        credentials: true,
      },
    });

    // 4. Initialize Redis adapter for horizontal scaling
    const redisUrl = process.env.REDIS_URL || process.env.REDIS_URI;
    if (redisUrl) {
      try {
        const pubClient = new Redis(redisUrl, {
          maxRetriesPerRequest: 3,
          retryStrategy: (times) => {
            if (times > 3) return null;
            return Math.min(times * 200, 2000);
          },
          lazyConnect: true,
        });

        const subClient = pubClient.duplicate();

        await Promise.all([pubClient.connect(), subClient.connect()]);

        io.adapter(createAdapter(pubClient, subClient));
        console.log('[Socket.IO] Redis adapter enabled for horizontal scaling');
      } catch (error) {
        console.warn('[Socket.IO] Failed to initialize Redis adapter, running in single-instance mode:', error);
      }
    } else {
      console.log('[Socket.IO] REDIS_URL not configured, running in single-instance mode');
    }

    // Make Socket.IO instance available to controllers
    setSocketIOInstance(io);

    // 5. Initialize Live Proctoring and Monitoring Gateway
    initMonitoringSocket(io);

    // 5.1 Initialize Notification Socket
    initNotificationSocket(io);

    // 6. Start HTTP + WebSocket Server binding to 0.0.0.0
    httpServer.listen(env.port, '0.0.0.0', () => {
      console.log(`Server running in ${env.node_env} mode on port ${env.port} (HTTP & Socket.IO)`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();