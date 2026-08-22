import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './lib/auth';
import { env } from './config/env';
import apiRoutes from './routes';

const app: Application = express();

// CORS configuration
app.use(
  cors({
    origin: [env.frontend_url, env.better_auth_url, 'http://localhost:3000'].filter(Boolean),
    credentials: true,
  })
);

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Better Auth Route Handler
app.all('/api/auth/*', toNodeHandler(auth));

// API Health Check
app.get('/api/health', (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'Testify API is running',
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
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled Error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

export default app;
