export const AUTH_REPOSITORY = Symbol('AUTH_REPOSITORY');
export const EMAIL_SENDER = Symbol('EMAIL_SENDER');
export const GOOGLE_OAUTH_CLIENT = Symbol('GOOGLE_OAUTH_CLIENT');

export const AUTH_COOKIE_NAMES = {
  full: 'gatelm_session',
  oauthState: 'gatelm_oauth_state',
  onboarding: 'gatelm_onboarding',
} as const;
