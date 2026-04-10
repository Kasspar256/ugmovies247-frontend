const rawAppEnv = (process.env.NEXT_PUBLIC_APP_ENV || 'development').toLowerCase();

export const APP_ENV =
  rawAppEnv === 'production'
    ? 'production'
    : rawAppEnv === 'staging'
      ? 'staging'
      : 'development';

export const APP_ENV_LABEL =
  APP_ENV === 'production'
    ? 'LIVE'
    : APP_ENV === 'staging'
      ? 'STAGING'
      : 'DEV';

export const IS_PRODUCTION_APP = APP_ENV === 'production';

export const FIREBASE_PROJECT_LABEL =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'unknown-project';

export const SHOULD_SHOW_ENV_BADGE =
  process.env.NEXT_PUBLIC_SHOW_ENV_BADGE === 'true' || !IS_PRODUCTION_APP;
