import app from './app';
import { connectDB } from './config/db';
import { env } from './config/env';
import { autoSeedDatabase } from './config/seed';

async function startServer(): Promise<void> {
  try {
    // 1. Connect to MongoDB Atlas
    await connectDB();
    await autoSeedDatabase();

    // 2. Start Express HTTP Server
    app.listen(env.port, () => {
      console.log(`Server running on port ${env.port}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
