import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface GoogleOAuthTokenResult {
  accessToken: string;
}

export interface GoogleOAuthProfile {
  email: string;
  emailVerified: boolean;
  name: string | null;
  providerSubject: string;
}

export interface GoogleOAuthClient {
  buildAuthorizationUrl(state: string): string;
  exchangeCode(code: string): Promise<GoogleOAuthTokenResult>;
  getProfile(accessToken: string): Promise<GoogleOAuthProfile>;
}

interface GoogleTokenResponse {
  access_token?: string;
}

interface GoogleUserInfoResponse {
  email?: string;
  email_verified?: boolean;
  name?: string;
  sub?: string;
}

const GOOGLE_OAUTH_TIMEOUT_MS = 10_000;

@Injectable()
export class GoogleOAuthHttpClient implements GoogleOAuthClient {
  constructor(private readonly config: ConfigService) {}

  buildAuthorizationUrl(state: string): string {
    const clientId = this.config.get<string>('GOOGLE_OAUTH_CLIENT_ID');
    if (!clientId) {
      throw new Error('Google OAuth client id is not configured.');
    }

    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', this.redirectUri());
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'select_account');

    return url.toString();
  }

  async exchangeCode(code: string): Promise<GoogleOAuthTokenResult> {
    const clientId = this.config.get<string>('GOOGLE_OAUTH_CLIENT_ID');
    const clientSecret = this.config.get<string>('GOOGLE_OAUTH_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      throw new Error('Google OAuth client credentials are not configured.');
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.redirectUri(),
      }),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
      signal: AbortSignal.timeout(GOOGLE_OAUTH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error('Google OAuth code exchange failed.');
    }

    const body = (await response.json()) as GoogleTokenResponse;
    if (!body.access_token) {
      throw new Error('Google OAuth response did not include an access token.');
    }

    return { accessToken: body.access_token };
  }

  async getProfile(accessToken: string): Promise<GoogleOAuthProfile> {
    const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(GOOGLE_OAUTH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error('Google OAuth profile lookup failed.');
    }

    const body = (await response.json()) as GoogleUserInfoResponse;
    if (!body.email || !body.sub) {
      throw new Error('Google OAuth profile is missing required identity.');
    }

    return {
      email: body.email,
      emailVerified: body.email_verified === true,
      name: body.name ?? null,
      providerSubject: body.sub,
    };
  }

  private redirectUri(): string {
    return (
      this.config.get<string>('GOOGLE_OAUTH_REDIRECT_URI') ??
      `${this.webOrigin()}/api/auth/google/callback`
    );
  }

  private webOrigin(): string {
    return this.config.get<string>('CONTROL_PLANE_WEB_ORIGIN') ?? 'http://localhost:3000';
  }
}
