import { buildBffPermissions } from './assertion-permissions';
import type { InternalAuthOperation } from './assertion-operation';

describe('buildBffPermissions', () => {
  const marketplaceIssuer = 'urn:gigzlk:local:bff:marketplace';
  const adminIssuer = 'urn:gigzlk:local:bff:admin';

  const isAllowed = buildBffPermissions({
    marketplaceIssuer,
    adminIssuer,
  });

  const commonOperations: InternalAuthOperation[] = [
    '/internal/v1/auth/login',
    '/internal/v1/auth/refresh',
    '/internal/v1/auth/session/check',
    '/internal/v1/auth/logout',
    '/internal/v1/auth/logout-all',
  ];

  it.each(commonOperations)(
    'allows both configured BFFs to call %s',
    (operation) => {
      expect(isAllowed(marketplaceIssuer, operation)).toBe(true);
      expect(isAllowed(adminIssuer, operation)).toBe(true);
    },
  );

  it('allows only admin to call the MFA challenge', () => {
    const operation = '/internal/v1/auth/mfa/challenge';

    expect(isAllowed(marketplaceIssuer, operation)).toBe(false);
    expect(isAllowed(adminIssuer, operation)).toBe(true);
  });

  it('denies unknown issuers', () => {
    expect(isAllowed('urn:gigzlk:unknown', '/internal/v1/auth/login')).toBe(
      false,
    );
  });

  it('matches issuer identities exactly', () => {
    expect(
      isAllowed(marketplaceIssuer.toUpperCase(), '/internal/v1/auth/login'),
    ).toBe(false);
  });

  it.each([
    { marketplaceIssuer: '', adminIssuer },
    { marketplaceIssuer, adminIssuer: '' },
    { marketplaceIssuer: ` ${marketplaceIssuer}`, adminIssuer },
    { marketplaceIssuer, adminIssuer: `${adminIssuer} ` },
    { marketplaceIssuer, adminIssuer: marketplaceIssuer },
  ])('rejects ambiguous permission configuration: %j', (config) => {
    expect(() => buildBffPermissions(config)).toThrow(
      'Invalid BFF permission configuration.',
    );
  });
});
