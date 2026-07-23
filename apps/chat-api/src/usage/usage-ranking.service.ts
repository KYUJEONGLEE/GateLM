import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

import { ControlPlaneClient } from '@/auth/control-plane.client';
import { SessionService } from '@/auth/session.service';

import type {
  UsageRankingMetric,
  UsageRankingRange,
  UsageRankingResponse,
} from './usage-ranking.contract';

@Injectable()
export class UsageRankingService {
  constructor(
    private readonly sessions: SessionService,
    private readonly controlPlane: ControlPlaneClient,
  ) {}

  async read(
    accessToken: string,
    range: UsageRankingRange,
    metric: UsageRankingMetric,
  ): Promise<UsageRankingResponse> {
    const actor = await this.sessions.authorizeExecution(accessToken);
    try {
      return await this.controlPlane.usageRanking({
        ...(actor.employeeId ? { viewerEmployeeId: actor.employeeId } : {}),
        metric,
        range,
        tenantId: actor.tenantId,
      });
    } catch {
      throw new HttpException(
        {
          code: 'CHAT_USAGE_UNAVAILABLE',
          message: 'Tenant Chat usage ranking is temporarily unavailable.',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
