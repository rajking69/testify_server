import mongoose from 'mongoose';
import dns from 'node:dns';
import { env } from './env';

// Configure DNS resolution fallback for MongoDB Atlas SRV records
try {
  dns.setDefaultResultOrder('ipv4first');
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {
  // Ignore DNS config failure if unsupported
}

export const connectDB = async (): Promise<void> => {
  try {
    if (!env.mongodb_uri) {
      throw new Error('MONGODB_URI is not defined in environment variables');
    }

    await mongoose.connect(env.mongodb_uri);
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
    process.exit(1);
  }
};
