import { Body, Controller, Get, Headers, Post, UseGuards } from '@nestjs/common';

import { ChatWebServiceGuard } from './chat-web-service.guard';
import {
  GoogleCompleteDto,
  InvitationIntentDto,
  InvitationPasswordDto,
  InvitationTokenDto,
  PasswordLoginDto,
  TenantSelectionDto,
} from './dto';
import { SessionService } from './session.service';

@Controller('internal/v1/tenant-chat/auth')
@UseGuards(ChatWebServiceGuard)
export class AuthController {
  constructor(private readonly sessions: SessionService) {}

  @Post('password')
  password(@Body() body: PasswordLoginDto) {
    return this.sessions.password(body.email, body.password, body.deviceId);
  }

  @Post('invitation-intents')
  invitationIntent(@Body() body: InvitationTokenDto) {
    return { intent: this.sessions.createInvitationIntent(body.token) };
  }

  @Post('invitations/resolve')
  resolveInvitation(@Body() body: InvitationIntentDto) {
    return this.sessions.resolveInvitation(body.intent);
  }

  @Post('invitations/accept-password')
  acceptPassword(@Body() body: InvitationPasswordDto) {
    return this.sessions.acceptPassword(
      body.intent,
      { name: body.name, password: body.password },
      body.deviceId,
    );
  }

  @Post('invitations/bind-existing')
  bindExisting(
    @Body() body: InvitationIntentDto,
    @Headers('x-gatelm-chat-access') accessToken: string,
  ) {
    return this.sessions.bindExisting(body.intent, accessToken);
  }

  @Post('google/start')
  googleStart() {
    return this.sessions.googleStart();
  }

  @Post('google/complete')
  googleComplete(
    @Body() body: GoogleCompleteDto,
    @Headers('x-gatelm-chat-invitation-intent') invitationIntent?: string,
  ) {
    return this.sessions.googleComplete({ ...body, invitationIntent });
  }

  @Get('session')
  current(@Headers('x-gatelm-chat-access') accessToken: string) {
    return this.sessions.current(accessToken);
  }

  @Post('tenant')
  selectTenant(
    @Body() body: TenantSelectionDto,
    @Headers('x-gatelm-chat-access') accessToken: string,
  ) {
    return this.sessions.selectTenant(accessToken, body.tenantId);
  }

  @Post('refresh')
  refresh(@Headers('x-gatelm-chat-refresh') refreshToken: string) {
    return this.sessions.refresh(refreshToken);
  }

  @Post('logout')
  async logout(
    @Headers('x-gatelm-chat-access') accessToken?: string,
    @Headers('x-gatelm-chat-refresh') refreshToken?: string,
  ) {
    await this.sessions.logout(accessToken, refreshToken);
    return { ok: true };
  }
}
