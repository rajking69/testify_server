import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import mongoose from "mongoose";
import { emailOTP } from "better-auth/plugins";
import { Resend } from "resend";
import { env } from "../config/env";

const dbProxy = new Proxy({} as any, {
  get(target, prop, receiver) {
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error("Database is not connected yet");
    }
    const val = Reflect.get(db, prop, receiver);
    return typeof val === "function" ? val.bind(db) : val;
  },
});

// Initialize Resend if API key is available
const resend = env.resend_api_key ? new Resend(env.resend_api_key) : null;
const fromEmail = env.resend_from_email;

export const auth = betterAuth({
  database: mongodbAdapter(dbProxy),
  secret: env.better_auth_secret,
  baseURL: env.better_auth_url,
  trustedOrigins: [env.frontend_url],
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    google: {
      clientId: env.google_client_id,
      clientSecret: env.google_client_secret,
    },
    github: {
      clientId: env.github_client_id,
      clientSecret: env.github_client_secret,
    },
  },
  user: {
    additionalFields: {
      role: {
        type: ["student", "teacher", "admin"],
        required: false,
        defaultValue: "student",
        input: false,
        returned: true,
      },
    },
  },
  plugins: [
    emailOTP({
      async sendVerificationOTP({ email, otp, type }) {
        if (type === "forget-password") {
          // Try to send email via Resend if configured
          if (resend) {
            try {
              await resend.emails.send({
                from: fromEmail,
                to: email,
                subject: "Reset your Testify password",
                html: `
                  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <div style="background: linear-gradient(135deg, #152234 0%, #0092E3 100%); padding: 30px; border-radius: 10px; text-align: center; margin-bottom: 20px;">
                      <h1 style="color: white; margin: 0; font-size: 24px;">Testify</h1>
                    </div>
                    <div style="background: #f8f9fa; padding: 30px; border-radius: 10px;">
                      <h2 style="color: #152234; margin-top: 0;">Password Reset Request</h2>
                      <p style="color: #475569; line-height: 1.6;">You recently requested to reset your password for your Testify account. Use the verification code below to proceed:</p>
                      <div style="background: white; border: 2px solid #0092E3; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
                        <span style="font-size: 32px; font-weight: bold; color: #152234; letter-spacing: 5px;">${otp}</span>
                      </div>
                      <p style="color: #475569; line-height: 1.6;">This code will expire in 10 minutes for your security.</p>
                      <p style="color: #696984; font-size: 14px; margin-top: 20px;">If you didn't request this password reset, please ignore this email.</p>
                    </div>
                    <div style="text-align: center; margin-top: 20px; color: #696984; font-size: 12px;">
                      <p>&copy; 2025 Testify. All rights reserved.</p>
                    </div>
                  </div>
                `,
              });
              console.log(`Email sent successfully to ${email}`);
            } catch (error) {
              console.error("Failed to send email via Resend:", error);
              // Fallback to console log if email sending fails
              console.log(`Password reset OTP for ${email}: ${otp}`);
            }
          } else {
            // Fallback to console log if Resend is not configured
            console.log(`Password reset OTP for ${email}: ${otp}`);
            console.log(
              "Note: Configure RESEND_API_KEY in environment variables to enable email sending",
            );
          }
        }
      },
      expiresIn: 600, // 10 minutes
      otpLength: 6,
      allowedAttempts: 3,
    }),
  ],
});
