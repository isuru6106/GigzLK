const INTERNAL_AUTH_OPERATIONS = [
  '/internal/v1/auth/login',
  '/internal/v1/auth/refresh',
  '/internal/v1/auth/session/check',
  '/internal/v1/auth/logout',
  '/internal/v1/auth/logout-all',
  '/internal/v1/auth/mfa/challenge',
] as const;

export type InternalAuthOperation = (typeof INTERNAL_AUTH_OPERATIONS)[number];

export function resolveInternalAuthOperation(
  method: string,
  originalTarget: string,
): InternalAuthOperation | undefined {
  if (method !== 'POST') {
    return undefined;
  }

  return INTERNAL_AUTH_OPERATIONS.find((path) => path === originalTarget);
}
