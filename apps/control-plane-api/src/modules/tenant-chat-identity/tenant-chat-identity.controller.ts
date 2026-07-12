import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';

import { DataEnvelope } from '@/common/types/envelope';

import {
  TenantChatGoogleCompleteDto,
  TenantChatGoogleStartDto,
  TenantChatInvitationBindDto,
  TenantChatInvitationPasswordDto,
  TenantChatInvitationTokenDto,
  TenantChatPasswordDto,
} from './dto/tenant-chat-identity.dto';
import { TenantChatIdentityService } from './tenant-chat-identity.service';
import { TenantChatServiceAuthGuard } from './tenant-chat-service-auth.guard';

@Controller('internal/v1/tenant-chat/identity')
@UseGuards(TenantChatServiceAuthGuard)
export class TenantChatIdentityController {
  constructor(private readonly service: TenantChatIdentityService) {}

  @Post('password')
  async password(@Body() body: TenantChatPasswordDto): Promise<DataEnvelope<unknown>> {
    return { data: await this.service.authenticatePassword(body) };
  }

  @Post('invitations/resolve')
  async resolveInvitation(
    @Body() body: TenantChatInvitationTokenDto,
  ): Promise<DataEnvelope<unknown>> {
    return { data: await this.service.resolveInvitation(body.token) };
  }

  @Post('invitations/accept-password')
  async acceptPassword(
    @Body() body: TenantChatInvitationPasswordDto,
  ): Promise<DataEnvelope<unknown>> {
    return { data: await this.service.acceptInvitationWithPassword(body) };
  }

  @Post('invitations/bind-existing')
  async bindExisting(
    @Body() body: TenantChatInvitationBindDto,
  ): Promise<DataEnvelope<unknown>> {
    return { data: await this.service.bindExistingInvitation(body) };
  }

  @Post('google/start')
  googleStart(@Body() body: TenantChatGoogleStartDto): DataEnvelope<unknown> {
    return { data: this.service.startGoogle(body.state) };
  }

  @Post('google/complete')
  async googleComplete(
    @Body() body: TenantChatGoogleCompleteDto,
  ): Promise<DataEnvelope<unknown>> {
    return { data: await this.service.completeGoogle(body) };
  }

  @Get('entitlements/:userId/:tenantId')
  async entitlement(
    @Param('userId') userId: string,
    @Param('tenantId') tenantId: string,
  ): Promise<DataEnvelope<unknown>> {
    return { data: await this.service.getEntitlement(userId, tenantId) };
  }

  @Get('entitlements/:userId')
  async entitlements(@Param('userId') userId: string): Promise<DataEnvelope<unknown>> {
    return { data: await this.service.getEntitlements(userId) };
  }
}
