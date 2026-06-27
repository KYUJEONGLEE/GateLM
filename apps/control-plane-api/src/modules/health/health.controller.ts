import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

interface HealthResponseDto {
  status: 'ok';
  dependencies?: {
    database: 'ok';
  };
}

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('healthz')
  healthz(): HealthResponseDto {
    return { status: 'ok' };
  }

  @Get('readyz')
  async readyz(): Promise<HealthResponseDto> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
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
}
