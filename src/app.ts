import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
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

// Helmet for security headers (CSP, HSTS, etc.)
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
        "img-src": ["'self'", "data:", "https:", "blob:"],
        "connect-src": ["'self'", "https://api.stripe.com", "wss:", "ws:"],
        "frame-src": ["'self'", "https://js.stripe.com", "https://hooks.stripe.com"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  })
);

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

// ─── Rate Limiting Helpers ────────────────────────────────────────────────────
// On Render (and most cloud platforms) the real client IP is in X-Forwarded-For.
// trust proxy: 1 tells Express to expose it as req.ip correctly.
// We still fall back to socket address so localhost dev always works.
const getClientIp = (req: Request): string => {
  // X-Forwarded-For can be a comma-separated list; take the first (real client)
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
    return first.trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
};

// Endpoints that are polled frequently — never rate-limit these
const isPollingEndpoint = (req: Request): boolean => {
  const path = req.path;
  return (
    path.includes('get-session') ||
    path.includes('heartbeat') ||
    path.includes('session')
  );
};

// ─── Auth Rate Limiter (sign-in / sign-up / password reset) ──────────────────
// Strict: only 20 auth attempts per 15 min per real IP
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skip: isPollingEndpoint,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: getClientIp,
  handler: (_req, res) => {
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

// ─── General API Rate Limiter ─────────────────────────────────────────────────
// 500 requests per 15 min per real IP — generous enough for polling dashboards
const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  skip: isPollingEndpoint,
  message: {
    success: false,
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many API requests. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: getClientIp,
});

// ─── Payment Rate Limiter ─────────────────────────────────────────────────────
// 50 requests per 15 min — enough for legit checkout flows
const paymentRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: {
    success: false,
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many payment requests. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: getClientIp,
});

// ─── Exam Action Rate Limiter ─────────────────────────────────────────────────
// 60 requests per 15 min per IP — covers submit/start/purchase
const examActionRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  skip: isPollingEndpoint,
  message: {
    success: false,
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many exam actions. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: getClientIp,
});

// Apply general API rate limiting (skips polling endpoints automatically)
app.use('/api', apiRateLimiter);

// Apply payment rate limiting
app.use('/api/payments', paymentRateLimiter);

// Apply exam action rate limiting
app.use('/api/exams/:id/submit', examActionRateLimiter);
app.use('/api/exams/:id/start-attempt', examActionRateLimiter);
app.use('/api/exams/:id/heartbeat', examActionRateLimiter);
app.use('/api/exams/:id/purchase', examActionRateLimiter);

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
