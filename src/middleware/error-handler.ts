import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';

export interface AppError extends Error {
  statusCode?: number;
  errorCode?: string;
  errors?: any;
}

export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  logger.error({
    message: err.message,
    stack: err.stack,
    errors: err.errors,
    path: req.path,
    method: req.method,
  });

  if (err.errorCode) {
    res.status(statusCode).json({
      success: false,
      error: err.errorCode,
      message,
    });
    return;
  }

  res.status(statusCode).json({
    status: 'error',
    statusCode,
    message,
    errors: err.errors || null,
  });
};
