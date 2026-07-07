import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

import { DataEnvelope } from '@/common/types/envelope';

import {
  AuthService,
  SessionIssue,
  SignupDraftIssue,
  SignupDraftUnauthorizedException,
} from './auth.service';
import { AUTH_COOKIE_NAMES } from './auth.tokens';
import {
  CreateOrganizationDto,
  LoginDto,
  SignupDto,
  VerifyEmailDto,
} from './dto/auth.dto';

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('signup')
  async signup(
    @Body() body: SignupDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<DataEnvelope<unknown>> {
    const result = await this.authService.signup(body);
    if (result.signupDraft) {
      this.setSignupDraftCookie(response, result.signupDraft);
    }
    if (result.session) {
      this.clearCookie(response, AUTH_COOKIE_NAMES.signup);
      this.setSessionCookie(response, result.session);
    }

    return {
      data: {
        acceptedProjectInvitation: result.acceptedProjectInvitation,
        session: result.session
          ? this.toSessionResponse(result.session)
          : undefined,
        user: result.user,
        verificationRequired: result.verificationRequired,
      },
    };
  }

  @Post('email/verify')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(
    @Body() body: VerifyEmailDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<DataEnvelope<unknown>> {
    let result: Awaited<ReturnType<AuthService['verifyEmail']>>;
    try {
      result = await this.authService.verifyEmail(
        this.readCookie(request, AUTH_COOKIE_NAMES.signup),
        body,
      );
    } catch (error) {
      if (
        error instanceof SignupDraftUnauthorizedException &&
        error.signupDraft
      ) {
        this.setSignupDraftCookie(response, error.signupDraft);
      }
      throw error;
    }
    if (result.signupDraft) {
      this.setSignupDraftCookie(response, result.signupDraft);
    }
    if (result.session) {
      this.clearCookie(response, AUTH_COOKIE_NAMES.signup);
      this.setSessionCookie(response, result.session);
    }

    return {
      data: {
        acceptedProjectInvitation: result.acceptedProjectInvitation,
        session: result.session
          ? this.toSessionResponse(result.session)
          : undefined,
        user: result.user,
      },
    };
  }

  @Get('project-admin-invitations/:token')
  async getProjectAdminInvitation(
    @Param('token') token: string,
  ): Promise<DataEnvelope<unknown>> {
    return {
      data: await this.authService.getProjectAdminInvitation(token),
    };
  }
  @Post('organizations')
  async createOrganization(
    @Body() body: CreateOrganizationDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<DataEnvelope<unknown>> {
    response.status(HttpStatus.CREATED);
    const result = await this.authService.createOrganization(
      {
        onboardingToken: this.readCookie(request, AUTH_COOKIE_NAMES.onboarding),
        signupDraftToken: this.readCookie(request, AUTH_COOKIE_NAMES.signup),
      },
      body,
    );
    this.clearCookie(response, AUTH_COOKIE_NAMES.onboarding);
    this.clearCookie(response, AUTH_COOKIE_NAMES.signup);
    this.setSessionCookie(response, result.session);

    return {
      data: {
        membership: result.membership,
        session: this.toSessionResponse(result.session),
        tenant: result.tenant,
        user: result.user,
      },
    };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<DataEnvelope<unknown>> {
    const result = await this.authService.login(body);
    this.setSessionCookie(response, result.session);

    return {
      data: {
        memberships: result.memberships,
        session: this.toSessionResponse(result.session),
        user: result.user,
      },
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<DataEnvelope<unknown>> {
    const result = await this.authService.logout([
      this.readCookie(request, AUTH_COOKIE_NAMES.full),
      this.readCookie(request, AUTH_COOKIE_NAMES.onboarding),
    ]);
    this.clearCookie(response, AUTH_COOKIE_NAMES.full);
    this.clearCookie(response, AUTH_COOKIE_NAMES.onboarding);
    this.clearCookie(response, AUTH_COOKIE_NAMES.signup);

    return { data: result };
  }

  @Get('me')
  async me(@Req() request: Request): Promise<DataEnvelope<unknown>> {
    return {
      data: await this.authService.me(
        this.readCookie(request, AUTH_COOKIE_NAMES.full) ??
          this.readCookie(request, AUTH_COOKIE_NAMES.onboarding),
      ),
    };
  }

  @Get('google/start')
  googleStart(@Res() response: Response): void {
    const result = this.authService.startGoogleOAuth();
    this.clearCookie(response, AUTH_COOKIE_NAMES.signup);
    response.cookie(AUTH_COOKIE_NAMES.oauthState, result.state, {
      ...this.baseCookieOptions(),
      expires: addMinutes(new Date(), 10),
    });
    response.redirect(result.authorizationUrl);
  }

  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.authService.completeGoogleOAuth({
      code,
      expectedState: this.readCookie(request, AUTH_COOKIE_NAMES.oauthState),
      state,
    });
    this.clearCookie(response, AUTH_COOKIE_NAMES.oauthState);
    this.clearCookie(response, AUTH_COOKIE_NAMES.signup);
    this.setSessionCookie(response, result.session);
    response.redirect(result.redirectUrl);
  }

  private setSessionCookie(response: Response, session: SessionIssue): void {
    const cookieName =
      session.kind === 'full'
        ? AUTH_COOKIE_NAMES.full
        : AUTH_COOKIE_NAMES.onboarding;
    response.cookie(cookieName, session.token, {
      ...this.baseCookieOptions(),
      expires: session.expiresAt,
    });
  }

  private setSignupDraftCookie(
    response: Response,
    signupDraft: SignupDraftIssue,
  ): void {
    response.cookie(AUTH_COOKIE_NAMES.signup, signupDraft.token, {
      ...this.baseCookieOptions(),
      expires: signupDraft.expiresAt,
    });
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
      secure: this.config.get<string>('CONTROL_PLANE_AUTH_COOKIE_SECURE') === 'true',
    };
  }

  private readCookie(request: Request, cookieName: string): string | undefined {
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

  private toSessionResponse(session: SessionIssue): {
    expiresAt: string;
    kind: string;
  } {
    return {
      expiresAt: session.expiresAt.toISOString(),
      kind: session.kind,
    };
  }
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}
