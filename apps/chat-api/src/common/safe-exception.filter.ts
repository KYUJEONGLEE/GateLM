import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (error instanceof HttpException) {
      const status = error.getStatus();
      const value = error.getResponse();
      const record = typeof value === 'object' && value ? (value as Record<string, unknown>) : {};
      response.status(status).json({
        code: typeof record.code === 'string' ? record.code : status === 400 ? 'CHAT_INVALID_REQUEST' : 'CHAT_AUTH_REQUIRED',
        message: typeof record.message === 'string' ? record.message : 'The request could not be completed.',
      });
      return;
    }
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: 'CHAT_INTERNAL_ERROR',
      message: 'The request could not be completed.',
    });
  }
}
