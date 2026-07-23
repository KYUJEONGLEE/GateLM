import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';

import { DataEnvelope } from '@/common/types/envelope';

import {
  TenantChatGoogleCompleteDto,
  TenantChatGoogleStartDto,
  TenantChatInvitationBindDto,
  TenantChatInvitationPasswordDto,
  TenantChatInvitationTokenDto,
  TenantChatPasswordChangeDto,
  TenantChatPasswordDto,
  TenantChatPasswordResetConfirmDto,
  TenantChatPasswordResetRequestDto,
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

  @Post('password-reset/request')
  @HttpCode(HttpStatus.OK)
  async requestPasswordReset(
    @Body() body: TenantChatPasswordResetRequestDto,
  ): Promise<DataEnvelope<unknown>> {
    return { data: await this.service.requestPasswordReset(body) };
  }

  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.OK)
  async confirmPasswordReset(
    @Body() body: TenantChatPasswordResetConfirmDto,
  ): Promise<DataEnvelope<unknown>> {
    return { data: await this.service.confirmPasswordReset(body) };
  }

  @Post('password/change')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body() body: TenantChatPasswordChangeDto,
  ): Promise<DataEnvelope<unknown>> {
    return { data: await this.service.changePassword(body) };
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
