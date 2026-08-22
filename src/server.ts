import mongoose from 'mongoose';
import dns from 'node:dns';
import app from './app';
import config from './config';

// Ensure IPv4 first and system/google DNS for MongoDB SRV records
try {
  dns.setDefaultResultOrder('ipv4first');
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (e) {
  // ignore if not supported in older node
}

async function main() {
  try {
    if (!config.database_url) {
      throw new Error('DATABASE_URL / MONGODB_URI is not defined in environment variables');
    }

    await mongoose.connect(config.database_url as string, {
      dbName: config.db_name,
    });
    console.log('⚡️ [database]: Connected to MongoDB successfully!');

    app.listen(config.port, () => {
      console.log(`🚀 [server]: Server is running on port ${config.port}`);
    });
  } catch (error) {
    console.error('❌ [error]: Failed to connect database/start server', error);
  }
}

main();
