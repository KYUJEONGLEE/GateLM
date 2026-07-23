import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

import { DataEnvelope } from '@/common/types/envelope';

import { AuthService } from './auth.service';
import { AUTH_COOKIE_NAMES } from './auth.tokens';
import {
  ChangePasswordDto,
  ConfirmPasswordResetDto,
  RequestPasswordResetDto,
} from './dto/auth.dto';

@Controller('api/auth')
export class PasswordAccountController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('password-reset/request')
  @HttpCode(HttpStatus.ACCEPTED)
  async requestPasswordReset(
    @Body() body: RequestPasswordResetDto,
  ): Promise<DataEnvelope<unknown>> {
    return { data: await this.authService.requestPasswordReset(body) };
  }

  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.OK)
  async confirmPasswordReset(
    @Body() body: ConfirmPasswordResetDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<DataEnvelope<unknown>> {
    const result = await this.authService.confirmPasswordReset(body);
    this.clearCookie(response, AUTH_COOKIE_NAMES.full);
    this.clearCookie(response, AUTH_COOKIE_NAMES.onboarding);
    this.clearCookie(response, AUTH_COOKIE_NAMES.signup);
    return { data: result };
  }

  @Post('password/change')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body() body: ChangePasswordDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<DataEnvelope<unknown>> {
    const result = await this.authService.changePassword(
      this.readCookie(request, AUTH_COOKIE_NAMES.full),
      body,
    );
    this.clearCookie(response, AUTH_COOKIE_NAMES.full);
    this.clearCookie(response, AUTH_COOKIE_NAMES.onboarding);
    this.clearCookie(response, AUTH_COOKIE_NAMES.signup);
    return { data: result };
  }

  private clearCookie(response: Response, cookieName: string): void {
    response.clearCookie(cookieName, this.baseCookieOptions());
  }

  private baseCookieOptions(): {
    httpOnly: true;
    path: string;
    sameSite: 'lax';
    secure: boolean;
  } {
    return {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure:
        this.config.get<string>('CONTROL_PLANE_AUTH_COOKIE_SECURE') === 'true',
    };
  }

  private readCookie(
    request: Request,
    cookieName: string,
  ): string | undefined {
    const cookieHeader = request.headers.cookie;
    if (!cookieHeader) {
      return undefined;
    }

    for (const cookie of cookieHeader.split(';')) {
      const [rawName, ...rawValue] = cookie.trim().split('=');
      if (rawName === cookieName) {
        return decodeURIComponent(rawValue.join('='));
      }
    }

    return undefined;
  }
}
