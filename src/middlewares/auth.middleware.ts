import { Request, Response, NextFunction } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../lib/auth';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: 'student' | 'teacher' | 'admin';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

// Optional Auth - Attaches user if token/session is provided, but does not reject guest
export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (session && session.user) {
      req.user = {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        role: ((session.user as any).role as 'student' | 'teacher' | 'admin') || 'student',
      };
    }
    next();
  } catch (error) {
    // Pass without attaching user
    next();
  }
};

// Require Auth - Rejects unauthenticated users with 401
export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session || !session.user) {
      res.status(401).json({
        success: false,
        code: 'UNAUTHORIZED',
        message: 'Authentication required. Please login to access this resource.',
      });
      return;
    }

    req.user = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: ((session.user as any).role as 'student' | 'teacher' | 'admin') || 'student',
    };

    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      code: 'UNAUTHORIZED',
      message: 'Invalid or expired session. Please login again.',
    });
  }
};

// Require Role - Checks user role against allowed roles
export const requireRole = (...allowedRoles: ('student' | 'teacher' | 'admin')[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role) && req.user.role !== 'admin') {
      res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: `Access denied. Requires one of: [${allowedRoles.join(', ')}]`,
      });
      return;
    }

    next();
  };
};
