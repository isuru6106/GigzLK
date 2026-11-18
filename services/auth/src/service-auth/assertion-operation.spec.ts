import { resolveInternalAuthOperation } from './assertion-operation';

describe('resolveInternalAuthOperation', () => {
  it.each([
    '/internal/v1/auth/login',
    '/internal/v1/auth/refresh',
    '/internal/v1/auth/session/check',
    '/internal/v1/auth/logout',
    '/internal/v1/auth/logout-all',
    '/internal/v1/auth/mfa/challenge',
  ])('accepts an exact POST operation: %s', (path) => {
    expect(resolveInternalAuthOperation('POST', path)).toBe(path);
  });

  it.each(['GET', 'PUT', 'DELETE', 'OPTIONS', 'post', 'Post'])(
    'rejects an unapproved method: %s',
    (method) => {
      expect(
        resolveInternalAuthOperation(method, '/internal/v1/auth/login'),
      ).toBeUndefined();
    },
  );

  it.each([
    '/internal/v1/auth/login/',
    '/internal/v1/auth/login?',
    '/internal/v1/auth/login?next=home',
    '/internal/v1/auth/%6cogin',
    '/internal/v1/auth//login',
    '/internal/v1/auth/./login',
    '/internal/v1/auth/../auth/login',
    '/internal/v1/auth\\login',
    '/internal/v1/auth/login;extra',
    '/internal/v1/auth/Login',
    '/internal/v1/auth/unknown',
  ])('rejects an alias or unlisted path: %s', (path) => {
    expect(resolveInternalAuthOperation('POST', path)).toBeUndefined();
  });
});
