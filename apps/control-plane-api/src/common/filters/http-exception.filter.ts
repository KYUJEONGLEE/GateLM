import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

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
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    this.logServerError(exception, status, request);

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

  private logServerError(
    exception: unknown,
    status: number,
    request: Request,
  ): void {
    if (status < HttpStatus.INTERNAL_SERVER_ERROR) {
      return;
    }

    const message =
      exception instanceof Error ? exception.message : String(exception);
    const stack = exception instanceof Error ? exception.stack : undefined;
    const method = request.method;
    const url = request.originalUrl ?? request.url;

    this.logger.error(
      `Control Plane request failed: status=${status} method=${method} url=${url} message=${message}`,
      stack,
    );
  }
}
