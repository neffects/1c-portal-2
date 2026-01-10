/**
 * Error Handling Middleware
 * 
 * Catches all errors and returns standardized error responses.
 * Includes logging and error categorization.
 */

import { Context } from 'hono';
import { ZodError } from 'zod';
import type { Env, Variables } from '../types';

/**
 * Custom application error class
 */
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 400,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * Not found error
 */
export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      'NOT_FOUND',
      id ? `${resource} with ID '${id}' not found` : `${resource} not found`,
      404
    );
  }
}

/**
 * Validation error
 */
export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('VALIDATION_ERROR', message, 400, details);
  }
}

/**
 * Unauthorized error
 */
export class UnauthorizedError extends AppError {
  constructor(message: string = 'Authentication required') {
    super('UNAUTHORIZED', message, 401);
  }
}

/**
 * Forbidden error
 */
export class ForbiddenError extends AppError {
  constructor(message: string = 'You do not have permission to perform this action') {
    super('FORBIDDEN', message, 403);
  }
}

/**
 * Conflict error (e.g., duplicate entry)
 */
export class ConflictError extends AppError {
  constructor(message: string) {
    super('CONFLICT', message, 409);
  }
}

/**
 * Format Zod validation errors into a readable format
 */
function formatZodError(error: ZodError): Record<string, string[]> {
  const formatted: Record<string, string[]> = {};
  
  for (const issue of error.issues) {
    const path = issue.path.join('.') || 'value';
    if (!formatted[path]) {
      formatted[path] = [];
    }
    formatted[path].push(issue.message);
  }
  
  return formatted;
}

/**
 * Global error handler
 */
export function errorHandler(
  error: Error,
  c: Context<{ Bindings: Env; Variables: Variables }>
) {
  console.error('[ErrorHandler] Error caught:', {
    name: error.name,
    message: error.message,
    stack: error.stack
  });
  
  // Handle Zod validation errors
  if (error instanceof ZodError) {
    return c.json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details: {
          fields: formatZodError(error)
        }
      }
    }, 400);
  }
  
  // Handle custom app errors
  if (error instanceof AppError) {
    return c.json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details
      }
    }, error.statusCode);
  }
  
  // Handle unknown errors
  const isProduction = c.env.ENVIRONMENT === 'production';
  
  return c.json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: isProduction
        ? 'An unexpected error occurred. Please try again later.'
        : error.message,
      details: isProduction ? undefined : { stack: error.stack }
    }
  }, 500);
}

/**
 * Async error wrapper for route handlers
 * Catches errors and passes them to the error handler
 */
export function asyncHandler<T>(
  handler: (c: Context<{ Bindings: Env; Variables: Variables }>) => Promise<T>
) {
  return async (c: Context<{ Bindings: Env; Variables: Variables }>) => {
    try {
      return await handler(c);
    } catch (error) {
      throw error; // Re-throw to be caught by global error handler
    }
  };
}
