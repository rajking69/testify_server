import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

export default {
  port: process.env.PORT || 5000,
  database_url: process.env.MONGODB_URI || process.env.DATABASE_URL,
  db_name: process.env.MONGODB_DB_NAME || process.env.DB_NAME,
  better_auth_secret: process.env.BETTER_AUTH_SECRET,
  better_auth_url: process.env.BETTER_AUTH_URL || 'http://localhost:5000',
};
