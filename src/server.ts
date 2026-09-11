import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import app from './app';
import { connectDB } from './config/db';
import { env } from './config/env';
import { initMonitoringSocket } from './sockets/monitoring.socket';

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

    // 4. Initialize Live Proctoring and Monitoring Gateway
    initMonitoringSocket(io);

    // 5. Start HTTP + WebSocket Server binding to 0.0.0.0
    httpServer.listen(env.port, '0.0.0.0', () => {
      console.log(`Server running in ${env.node_env} mode on port ${env.port} (HTTP & Socket.IO)`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
