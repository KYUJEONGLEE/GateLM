import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  UseGuards,
} from '@nestjs/common';

import { DataEnvelope } from '@/common/types/envelope';
import { TenantChatServiceAuthGuard } from '@/modules/tenant-chat-identity/tenant-chat-service-auth.guard';

import { TenantChatRuntimeService } from './tenant-chat-runtime.service';

export type TenantChatRuntimeSnapshotMetadata = {
  tenantId: string;
  version: number;
  digest: string;
  policyVersion: number;
  employeeNoticeVersion: number;
  pricingVersion: number;
};

@Controller('internal/v1/tenant-chat/runtime/snapshots')
@UseGuards(TenantChatServiceAuthGuard)
export class TenantChatRuntimeController {
  constructor(private readonly service: TenantChatRuntimeService) {}

  @Get(':tenantId/active')
  async activeSnapshot(
    @Param('tenantId') tenantId: string,
  ): Promise<DataEnvelope<TenantChatRuntimeSnapshotMetadata>> {
    try {
      const snapshot = await this.service.getActiveSnapshot(tenantId);
      if (snapshot.tenantId !== tenantId) {
        throw new Error('active snapshot tenant mismatch');
      }
      return {
        data: {
          tenantId: snapshot.tenantId,
          version: snapshot.version,
          digest: snapshot.digest,
          policyVersion: snapshot.policyVersion,
          employeeNoticeVersion: snapshot.employeeNoticeVersion,
          pricingVersion: snapshot.pricing.version,
        },
      };
    } catch {
      throw new HttpException(
        {
          code: 'CHAT_RUNTIME_UNAVAILABLE',
          message: 'Tenant Chat runtime metadata is unavailable.',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
