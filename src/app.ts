import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './lib/auth';
import { env } from './config/env';
import apiRoutes from './routes';
import { Server as SocketIOServer } from 'socket.io';

const app: Application = express();

// Socket.IO instance holder
let socketIOInstance: SocketIOServer | null = null;

export function setSocketIOInstance(io: SocketIOServer) {
  socketIOInstance = io;
}

export function getSocketIOInstance(): SocketIOServer | null {
  return socketIOInstance;
}

// Trust reverse proxy (Required for Render HTTPS load balancers)
app.set('trust proxy', 1);

// Normalize allowed origins (strip trailing slash)
const allowedOrigins = env.allowed_origins.map((o) => o.replace(/\/+$/, ''));

// Helper to check whether an incoming origin is permitted
const isOriginAllowed = (origin: string): boolean => {
  const normalized = origin.replace(/\/+$/, '');
  if (allowedOrigins.includes(normalized)) {
    return true;
  }
  // Allow localhost & 127.0.0.1 on any port in development
  if (!env.is_production && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalized)) {
    return true;
  }
  // Allow preview deployments on Vercel
  if (/^https?:\/\/[a-zA-Z0-9-_]+\.vercel\.app$/.test(normalized)) {
    return true;
  }
  return false;
};

// Dynamic CORS Configuration
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server, health checks)
      if (!origin) {
        return callback(null, true);
      }
      if (isOriginAllowed(origin)) {
        return callback(null, true);
      }
      console.warn(`[CORS] Blocked request from origin: ${origin}`);
      return callback(new Error(`CORS policy: Origin ${origin} not allowed by Access-Control-Allow-Origin.`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'X-Requested-With', 'Accept'],
    exposedHeaders: ['Set-Cookie'],
  })
);

// Body parsers with rawBody preservation for Stripe webhook signature verification
app.use(
  express.json({
    verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true }));

// Rate limiting for authentication endpoints
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit each IP to 20 requests per windowMs
  message: {
    success: false,
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many authentication attempts. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  // Trust proxy is already set for Render
  keyGenerator: (req) => req.ip || req.socket.remoteAddress || 'unknown',
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many authentication attempts. Please try again later.',
    });
  },
});

// Apply rate limiting to auth endpoints
app.use('/api/auth/sign-in', authRateLimiter);
app.use('/api/auth/sign-up', authRateLimiter);
app.use('/api/auth/forget-password', authRateLimiter);
app.use('/api/auth/reset-password', authRateLimiter);
app.use('/api/auth/verify-email', authRateLimiter);
app.use('/api/auth/send-verification-otp', authRateLimiter);

// Better Auth Route Handler
app.all('/api/auth/*', toNodeHandler(auth));

// Root Route
app.get('/', (req: Request, res: Response) => {
  res.status(200).send('Testify Server is running');
});

// API Health Check
app.get('/', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    message: 'Server is running',
    environment: env.node_env,
  });
});

// App API Routes (/api/exams, /api/subscriptions)
app.use('/api', apiRoutes);

// 404 Handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    code: 'NOT_FOUND',
    message: 'Route Not Found',
  });
});

// Global Error Handler
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled Error:', err);
  const status = err.status || err.statusCode || (err.message?.startsWith('CORS policy') ? 403 : 500);
  res.status(status).json({
    success: false,
    code: err.code || (status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR'),
    message: err.message || 'Internal Server Error',
  });
});

export default app;
