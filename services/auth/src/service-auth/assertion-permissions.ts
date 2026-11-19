import type { InternalAuthOperation } from './assertion-operation';

export interface BffPermissionConfig {
  marketplaceIssuer: string;
  adminIssuer: string;
}

export function buildBffPermissions(config: BffPermissionConfig) {
  const { marketplaceIssuer, adminIssuer } = config;

  if (
    !marketplaceIssuer.trim() ||
    !adminIssuer.trim() ||
    marketplaceIssuer !== marketplaceIssuer.trim() ||
    adminIssuer !== adminIssuer.trim() ||
    marketplaceIssuer === adminIssuer
  ) {
    throw new Error('Invalid BFF permission configuration.');
  }

  const commonOperations = new Set<InternalAuthOperation>([
    '/internal/v1/auth/login',
    '/internal/v1/auth/refresh',
    '/internal/v1/auth/session/check',
    '/internal/v1/auth/logout',
    '/internal/v1/auth/logout-all',
  ]);

  const adminOperations = new Set<InternalAuthOperation>([
    ...commonOperations,
    '/internal/v1/auth/mfa/challenge',
  ]);

  const permissions = new Map([
    [marketplaceIssuer, commonOperations],
    [adminIssuer, adminOperations],
  ]);

  return (verifiedIssuer: string, operation: InternalAuthOperation): boolean =>
    permissions.get(verifiedIssuer)?.has(operation) ?? false;
}
