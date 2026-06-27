import {
  Controller,
  Get,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

interface HealthResponseDto {
  status: 'ok';
  dependencies?: {
    database: 'ok';
  };
}

@Controller()
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get('healthz')
  healthz(): HealthResponseDto {
    return { status: 'ok' };
  }

  @Get('readyz')
  async readyz(): Promise<HealthResponseDto> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      this.logger.error(
        `Control Plane readiness check failed: dependency=database message=${this.sanitizeLogValue(
          error instanceof Error ? error.message : String(error),
        )}`,
        error instanceof Error && error.stack
          ? this.sanitizeLogValue(error.stack)
          : undefined,
      );

      throw new ServiceUnavailableException(
        'Control Plane dependencies are not ready.',
      );
    }

    return {
      status: 'ok',
      dependencies: {
        database: 'ok',
      },
    };
  }

  private sanitizeLogValue(value: string): string {
    return value.replace(/[\r\n]+/g, ' ').trim();
  }
}
