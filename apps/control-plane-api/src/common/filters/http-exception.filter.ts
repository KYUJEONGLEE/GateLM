import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown> | null;
    requestId: string | null;
    retryable: boolean;
  };
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    response.status(status).json(this.toErrorEnvelope(exception));
  }

  private toErrorEnvelope(exception: unknown): ErrorEnvelope {
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const message =
        typeof body === 'object' && body !== null && 'message' in body
          ? String((body as { message: unknown }).message)
          : exception.message;

      return {
        error: {
          code: this.toErrorCode(exception.getStatus()),
          message,
          details: null,
          requestId: null,
          retryable: false,
        },
      };
    }

    return {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error.',
        details: null,
        requestId: null,
        retryable: false,
      },
    };
  }

  private toErrorCode(status: number): string {
    if (status === HttpStatus.BAD_REQUEST) {
      return 'VALIDATION_ERROR';
    }
    if (status === HttpStatus.NOT_FOUND) {
      return 'NOT_FOUND';
    }
    if (status === HttpStatus.UNAUTHORIZED) {
      return 'UNAUTHORIZED';
    }
    if (status === HttpStatus.FORBIDDEN) {
      return 'FORBIDDEN';
    }
    if (status === HttpStatus.CONFLICT) {
      return 'CONFLICT';
    }

    return 'INTERNAL_ERROR';
  }
}
