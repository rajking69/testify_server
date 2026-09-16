import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(process.cwd(), ".env") });

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

// Support both CLIENT_URL and FRONTEND_URL
const clientUrl = (process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');

// Parse custom trusted origins list (comma-separated or single)
const rawTrustedOrigins = process.env.BETTER_AUTH_TRUSTED_ORIGINS || '';
const parsedTrustedOrigins = rawTrustedOrigins
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);

// Default development and production origins
const defaultOrigins = [
  clientUrl,
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5000',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:5000',
  'https://testify-client.vercel.app',
];

const allowedOriginsSet = new Set<string>([
  ...defaultOrigins,
  ...parsedTrustedOrigins,
]);

export const env = {
  node_env: nodeEnv,
  is_production: isProduction,
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 5000,
  mongodb_uri: process.env.MONGODB_URI || '',
  mongodb_db_name: process.env.MONGODB_DB_NAME || 'testify',
  client_url: clientUrl,
  frontend_url: clientUrl,
  better_auth_secret: process.env.BETTER_AUTH_SECRET || 'secret_key',
  better_auth_url: (process.env.BETTER_AUTH_URL || 'http://localhost:5000').replace(/\/+$/, ''),
  better_auth_trusted_origins: parsedTrustedOrigins,
  allowed_origins: Array.from(allowedOriginsSet).filter(Boolean),
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
  gemini_api_key: process.env.GEMINI_API_KEY || '',
  gemini_model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
};
