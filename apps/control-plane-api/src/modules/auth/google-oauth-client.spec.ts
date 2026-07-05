import { ConfigService } from '@nestjs/config';

import { GoogleOAuthHttpClient } from './google-oauth-client';

describe('GoogleOAuthHttpClient', () => {
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
});
