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
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google", "github"],
    },
  },
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    ...(env.google_client_id && env.google_client_secret
      ? {
                    google: {
            clientId: env.google_client_id,
            clientSecret: env.google_client_secret,
            prompt: "select_account",
            authParams: {
              prompt: "select_account",
            },
            authorization: {
              params: {
                prompt: "select_account",
              },
            },
          },
        }
      : {}),
    ...(env.github_client_id && env.github_client_secret
      ? {
          github: {
            clientId: env.github_client_id,
            clientSecret: env.github_client_secret,
          },
        }
      : {}),
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user: any, context: any) => {
          let selectedRole = user.role;
          const req = context?.request;
          if (req) {
            const cookieHeader = req.headers?.get ? req.headers.get('cookie') : (req.headers as any)?.cookie;
            if (cookieHeader) {
              const match = cookieHeader.match(/testify_oauth_role=([^;]+)/);
              if (match && ['student', 'teacher', 'admin'].includes(match[1])) {
                selectedRole = match[1];
              }
            }
          }
          return {
            data: {
              ...user,
              role: selectedRole || 'student',
            },
          };
        },
      },
    },
  },
  user: {
    additionalFields: {
      role: {
        type: ["student", "teacher", "admin"],
        required: false,
        defaultValue: "student",
        input: true,
        returned: true,
      },
    },
  },
  advanced: {
    useSecureCookies: env.is_production,
    defaultCookieAttributes: {
      sameSite: env.is_production ? 'none' : 'lax',
      secure: env.is_production,
      httpOnly: true,
      ...(env.is_production ? { partitioned: true } : {}),
    },
  },
  trustedOrigins: [
    ...env.allowed_origins,
    'https://*.vercel.app',
  ].filter(Boolean),
  plugins: [
    emailOTP({
      async sendVerificationOTP({ email, otp, type }) {
        let subject = "Testify Verification Code";
        let title = "Verification Code";
        let description = "Use the verification code below to proceed:";

        if (type === "forget-password") {
          subject = "Reset your Testify password";
          title = "Password Reset Request";
          description = "You recently requested to reset your password for your Testify account. Use the verification code below to proceed:";
        } else if (type === "sign-in") {
          subject = "Sign in to Testify";
          title = "Sign In Request";
          description = "Use the verification code below to sign in to your Testify account:";
        } else if (type === "email-verification") {
          subject = "Verify your Testify email";
          title = "Email Verification";
          description = "Use the verification code below to verify your email address for your Testify account:";
        }

        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #152234 0%, #0092E3 100%); padding: 30px; border-radius: 10px; text-align: center; margin-bottom: 20px;">
              <h1 style="color: white; margin: 0; font-size: 24px;">Testify</h1>
            </div>
            <div style="background: #f8f9fa; padding: 30px; border-radius: 10px;">
              <h2 style="color: #152234; margin-top: 0;">${title}</h2>
              <p style="color: #475569; line-height: 1.6;">${description}</p>
              <div style="background: white; border: 2px solid #0092E3; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
                <span style="font-size: 32px; font-weight: bold; color: #152234; letter-spacing: 5px;">${otp}</span>
              </div>
              <p style="color: #475569; line-height: 1.6;">This code will expire in 10 minutes for your security.</p>
              <p style="color: #696984; font-size: 14px; margin-top: 20px;">If you didn't request this action, please ignore this email.</p>
            </div>
            <div style="text-align: center; margin-top: 20px; color: #696984; font-size: 12px;">
              <p>&copy; ${new Date().getFullYear()} Testify. All rights reserved.</p>
            </div>
          </div>
        `;

        if (resend && fromEmail) {
          try {
            await resend.emails.send({
              from: fromEmail,
              to: email,
              subject,
              html,
            });
            console.log(`Email sent successfully to ${email} for ${type}`);
          } catch (error) {
            console.error("Failed to send email via Resend:", error);
            console.log(`Fallback OTP for ${email} (${type}): ${otp}`);
          }
        } else {
          console.log(`OTP for ${email} (${type}): ${otp}`);
          if (!resend) console.log("Note: Configure resend_api_key in env to enable email sending");
          if (!fromEmail) console.log("Note: Configure resend_from_email in env to enable email sending");
        }
      },
      expiresIn: 600, // 10 minutes
      otpLength: 6,
    }),
  ],
});
