import { Controller, Get } from '@nestjs/common';

interface HealthResponseDto {
  status: 'ok';
}

@Controller()
export class HealthController {
  @Get('healthz')
  healthz(): HealthResponseDto {
    return { status: 'ok' };
  }

  @Get('readyz')
  readyz(): HealthResponseDto {
    return { status: 'ok' };
  }
}
