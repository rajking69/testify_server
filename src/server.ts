import app from './app';
import { connectDB } from './config/db';
import { env } from './config/env';

async function startServer(): Promise<void> {
  try {
    // 1. Connect to MongoDB Atlas
    await connectDB();

    // 2. Start Express HTTP Server binding to 0.0.0.0 for host compatibility (Render)
    app.listen(env.port, '0.0.0.0', () => {
      console.log(`Server running in ${env.node_env} mode on port ${env.port}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
