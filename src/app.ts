import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './lib/auth';
import { env } from './config/env';
import { connectDB } from './config/db';
import apiRoutes from './routes';

const app: Application = express();

// Allowed Origins for CORS
const allowedOrigins = [
  env.frontend_url,
  env.better_auth_url,
  'http://localhost:3000',
  'http://localhost:5000',
].filter(Boolean);

// Dynamic CORS Configuration to support Vercel preview/production deployments
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);
      
      const isAllowed =
        allowedOrigins.includes(origin) ||
        origin.endsWith('.vercel.app') ||
        process.env.NODE_ENV !== 'production';

      if (isAllowed) {
        callback(null, true);
      } else {
        callback(null, true); // Fallback to allow cross-origin requests from Vercel
      }
    },
    credentials: true,
  })
);

// Auto-connect DB middleware for serverless/Vercel functions
app.use(async (req: Request, res: Response, next: NextFunction) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    next(error);
  }
});

// Body parsers with rawBody preservation for Stripe webhook signature verification
app.use(
  express.json({
    verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true }));

// Better Auth Route Handler
app.all('/api/auth/*', toNodeHandler(auth));

// Root Route
app.get('/', (req: Request, res: Response) => {
  res.status(200).send('Testify Server is running');
});

// API Health Check
app.get('/api/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    message: 'Server is running',
  });
});

// App API Routes (/api/exams, /api/subscriptions)
app.use('/api', apiRoutes);

// 404 Handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: 'Route Not Found',
  });
});

// Global Error Handler
app.use((err: Error & { status?: number }, req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled Error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

export default app;
