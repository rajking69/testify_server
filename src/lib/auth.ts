import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import mongoose from 'mongoose';
import { env } from '../config/env';

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
  secret: env.better_auth_secret,
  baseURL: env.better_auth_url,
  emailAndPassword: {
    enabled: true,
  },
  user: {
    additionalFields: {
      role: {
        type: 'string',
        required: false,
        defaultValue: 'student',
        input: true, // Allow role ('student' | 'teacher') during sign up
      },
    },
  },
  trustedOrigins: [env.frontend_url, env.better_auth_url, 'http://localhost:3000'].filter(Boolean),
});
