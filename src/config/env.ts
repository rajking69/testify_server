import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

export const env = {
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 5000,
  mongodb_uri: process.env.MONGODB_URI || '',
  frontend_url: process.env.FRONTEND_URL || 'http://localhost:3000',
  better_auth_secret: process.env.BETTER_AUTH_SECRET || 'secret_key',
  better_auth_url: process.env.BETTER_AUTH_URL || 'http://localhost:5000',
};
