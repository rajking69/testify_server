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
    },
  },
  trustedOrigins: [
    ...env.allowed_origins,
    'https://*.vercel.app',
  ].filter(Boolean),
});
