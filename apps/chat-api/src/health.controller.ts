import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from './database/prisma.service';
import { TenantContentKeyService } from './content/tenant-content-key.service';
import { PrivateGatewayClient } from './execution/private-gateway.client';
import { WorkloadCredentialsService } from './execution/workload-credentials';

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: WorkloadCredentialsService,
    private readonly gateway: PrivateGatewayClient,
    private readonly contentKeys: TenantContentKeyService,
  ) {}

  @Get('healthz')
  health() {
    return { status: 'ok' };
  }

  @Get('readyz')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      if (
        !this.gateway.isConfigured() ||
        !(await this.credentials.isReady()) ||
        !(await this.contentKeys.isReady())
      ) {
        throw new Error('execution credentials unavailable');
      }
      return { status: 'ready' };
    } catch {
      throw new HttpException(
        { code: 'CHAT_RUNTIME_UNAVAILABLE', message: 'Tenant Chat API is not ready.' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
