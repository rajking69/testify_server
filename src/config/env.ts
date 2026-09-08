import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(process.cwd(), ".env") });

export const env = {
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 5000,
  mongodb_uri: process.env.MONGODB_URI as string,
  frontend_url: process.env.FRONTEND_URL as string,
  better_auth_secret: process.env.BETTER_AUTH_SECRET as string,
  better_auth_url: process.env.BETTER_AUTH_URL as string,
  resend_api_key: process.env.RESEND_API_KEY as string,
  resend_from_email: process.env.RESEND_FROM_EMAIL as string,
  google_client_id: process.env.GOOGLE_CLIENT_ID as string,
  google_client_secret: process.env.GOOGLE_CLIENT_SECRET as string,
  github_client_id: process.env.GITHUB_CLIENT_ID as string,
  github_client_secret: process.env.GITHUB_CLIENT_SECRET as string,
};
