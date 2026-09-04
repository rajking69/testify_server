import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

export const env = {
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 5000,
  mongodb_uri: process.env.MONGODB_URI || '',
  mongodb_db_name: process.env.MONGODB_DB_NAME || 'testify',
  frontend_url: process.env.FRONTEND_URL || 'http://localhost:3000',
  better_auth_secret: process.env.BETTER_AUTH_SECRET || 'secret_key',
  better_auth_url: process.env.BETTER_AUTH_URL || 'http://localhost:5000',
  resend_api_key: process.env.RESEND_API_KEY || '',
  resend_from_email: process.env.RESEND_FROM_EMAIL || '',
  google_client_id: process.env.GOOGLE_CLIENT_ID || '',
  google_client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
  github_client_id: process.env.GITHUB_CLIENT_ID || '',
  github_client_secret: process.env.GITHUB_CLIENT_SECRET || '',
  stripe_secret_key: process.env.STRIPE_SECRET_KEY || '',
  stripe_publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || '',
  stripe_webhook_secret: process.env.STRIPE_WEBHOOK_SECRET || '',
  stripe_teacher_premium_price_id: process.env.STRIPE_TEACHER_PREMIUM_PRICE_ID || '',
};
