import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { logger } from '../lib/logger';

export const validate = (schema: ZodSchema) => 
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      return next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.issues.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        
        logger.warn({
          path: req.path,
          method: req.method,
          errors,
        }, 'Validation failed');
        
        res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          errors,
        });
        return;
      }
      
      logger.error({ error, path: req.path }, 'Validation middleware error');
      res.status(500).json({
        success: false,
        code: 'INTERNAL_ERROR',
        message: 'Validation failed',
      });
      return;
    }
  };

export const validateBody = (schema: ZodSchema) => 
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await schema.parseAsync(req.body);
      return next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.issues.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        
        logger.warn({
          path: req.path,
          method: req.method,
          errors,
        }, 'Body validation failed');
        
        res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          errors,
        });
        return;
      }
      
      res.status(500).json({
        success: false,
        code: 'INTERNAL_ERROR',
        message: 'Validation failed',
      });
      return;
    }
  };

export const validateQuery = (schema: ZodSchema) => 
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await schema.parseAsync(req.query);
      return next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.issues.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        
        logger.warn({
          path: req.path,
          method: req.method,
          errors,
        }, 'Query validation failed');
        
        res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          errors,
        });
        return;
      }
      
      res.status(500).json({
        success: false,
        code: 'INTERNAL_ERROR',
        message: 'Validation failed',
      });
      return;
    }
  };

export const validateParams = (schema: ZodSchema) => 
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await schema.parseAsync(req.params);
      return next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.issues.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        
        logger.warn({
          path: req.path,
          method: req.method,
          errors,
        }, 'Params validation failed');
        
        res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: 'Invalid route parameters',
          errors,
        });
        return;
      }
      
      res.status(500).json({
        success: false,
        code: 'INTERNAL_ERROR',
        message: 'Validation failed',
      });
      return;
    }
  };