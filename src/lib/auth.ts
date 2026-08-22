import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import mongoose from 'mongoose';
import config from '../config';

const dbProxy = new Proxy({} as any, {
  get(target, prop, receiver) {
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('Database is not connected yet');
    }
    const val = Reflect.get(db, prop, receiver);
    return typeof val === 'function' ? val.bind(db) : val;
  },
});

export const auth = betterAuth({
  database: mongodbAdapter(dbProxy),
  secret: config.better_auth_secret,
  baseURL: config.better_auth_url,
  emailAndPassword: {
    enabled: true,
  },
  trustedOrigins: ['http://localhost:3000', 'http://localhost:5000'],
});
