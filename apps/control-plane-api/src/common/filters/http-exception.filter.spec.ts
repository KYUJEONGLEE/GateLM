import { Logger } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';

import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter safe operational logging', () => {
  it('logs only the request path and never query values on server errors', () => {
    const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const request = {
      method: 'GET',
      originalUrl: '/admin/v1/tenants/tenant/rag/documents?displayName=secret.pdf',
      path: '/admin/v1/tenants/tenant/rag/documents',
      url: '/admin/v1/tenants/tenant/rag/documents?displayName=secret.pdf',
      header: jest.fn().mockImplementation((name: string) =>
        name === 'x-gatelm-request-id'
          ? 'secret prompt or api-key-value'
          : undefined,
      ),
    };
    const host = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ status, json }),
      }),
    } as unknown as ArgumentsHost;

    new HttpExceptionFilter().catch(new Error('database unavailable'), host);

    const serialized = JSON.stringify(logger.mock.calls);
    expect(serialized).toContain('/admin/v1/tenants/tenant/rag/documents');
    expect(serialized).not.toContain('displayName');
    expect(serialized).not.toContain('secret.pdf');
    expect(serialized).not.toContain('api-key-value');
    expect(String(logger.mock.calls[0]?.[0])).toContain('"requestId":null');
    expect(status).toHaveBeenCalledWith(500);
    logger.mockRestore();
  });
});
