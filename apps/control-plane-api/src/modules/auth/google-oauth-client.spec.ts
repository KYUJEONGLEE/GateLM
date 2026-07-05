import { ConfigService } from '@nestjs/config';

import { GoogleOAuthHttpClient } from './google-oauth-client';

describe('GoogleOAuthHttpClient', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses the web auth proxy callback URL by default', () => {
    const client = new GoogleOAuthHttpClient(
      new ConfigService({
        CONTROL_PLANE_WEB_ORIGIN: 'http://localhost:3000',
        GOOGLE_OAUTH_CLIENT_ID: 'google-client-id',
      }),
    );

    const url = new URL(client.buildAuthorizationUrl('oauth-state'));

    expect(url.origin + url.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(url.searchParams.get('client_id')).toBe('google-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/api/auth/google/callback',
    );
    expect(url.searchParams.get('state')).toBe('oauth-state');
  });

  it('uses a timeout signal when exchanging an OAuth code', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'google-access-token' }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    );
    const client = new GoogleOAuthHttpClient(
      new ConfigService({
        CONTROL_PLANE_WEB_ORIGIN: 'http://localhost:3000',
        GOOGLE_OAUTH_CLIENT_ID: 'google-client-id',
        GOOGLE_OAUTH_CLIENT_SECRET: 'google-client-secret',
      }),
    );

    await expect(client.exchangeCode('oauth-code')).resolves.toEqual({
      accessToken: 'google-access-token',
    });

    const requestInit = fetchMock.mock.calls[0]?.[1];
    expect(requestInit?.signal).toBeInstanceOf(AbortSignal);
  });

  it('uses a timeout signal when fetching a Google profile', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          email: 'owner@example.com',
          email_verified: true,
          name: 'Owner User',
          sub: 'google-subject',
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      ),
    );
    const client = new GoogleOAuthHttpClient(
      new ConfigService({
        CONTROL_PLANE_WEB_ORIGIN: 'http://localhost:3000',
      }),
    );

    await expect(client.getProfile('google-access-token')).resolves.toEqual({
      email: 'owner@example.com',
      emailVerified: true,
      name: 'Owner User',
      providerSubject: 'google-subject',
    });

    const requestInit = fetchMock.mock.calls[0]?.[1];
    expect(requestInit?.signal).toBeInstanceOf(AbortSignal);
  });
});
