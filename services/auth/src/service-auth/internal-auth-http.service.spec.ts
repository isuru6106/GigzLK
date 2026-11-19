import {
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AssertionAdmissionService } from './assertion-admission.service';
import { InternalAuthHttpService } from './internal-auth-http.service';

describe('InternalAuthHttpService', () => {
  const marketplaceIssuer = 'urn:gigzlk:local:bff:marketplace';
  const adminIssuer = 'urn:gigzlk:local:bff:admin';

  const execute = jest.fn<
    Promise<string>,
    [string, (issuer: string) => boolean, (issuer: string) => unknown]
  >();

  const admission = { execute } as unknown as AssertionAdmissionService;
  const operation = () => 'completed';

  const request = {
    method: 'POST',
    originalUrl: '/internal/v1/auth/login',
    rawHeaders: ['Authorization', 'Bearer AQ.AQ.AQ'],
  };

  let previousMarketplace: string | undefined;
  let previousAdmin: string | undefined;

  beforeEach(() => {
    previousMarketplace = process.env.AUTH_MARKETPLACE_BFF_ISSUER;
    previousAdmin = process.env.AUTH_ADMIN_BFF_ISSUER;

    process.env.AUTH_MARKETPLACE_BFF_ISSUER = marketplaceIssuer;
    process.env.AUTH_ADMIN_BFF_ISSUER = adminIssuer;
    execute.mockReset().mockResolvedValue('completed');
  });

  afterEach(() => {
    if (previousMarketplace === undefined) {
      delete process.env.AUTH_MARKETPLACE_BFF_ISSUER;
    } else {
      process.env.AUTH_MARKETPLACE_BFF_ISSUER = previousMarketplace;
    }

    if (previousAdmin === undefined) {
      delete process.env.AUTH_ADMIN_BFF_ISSUER;
    } else {
      process.env.AUTH_ADMIN_BFF_ISSUER = previousAdmin;
    }
  });

  it('passes the token, permission check and operation to admission', async () => {
    const service = new InternalAuthHttpService(admission);

    await expect(service.execute(request, operation)).resolves.toBe(
      'completed',
    );

    const [token, isAllowed, callback] = execute.mock.calls[0];

    expect(token).toBe('AQ.AQ.AQ');
    expect(callback).toBe(operation);
    expect(isAllowed(marketplaceIssuer)).toBe(true);
    expect(isAllowed(adminIssuer)).toBe(true);
    expect(isAllowed('unknown')).toBe(false);
  });

  it('restricts the MFA operation to the admin issuer', async () => {
    const service = new InternalAuthHttpService(admission);

    await service.execute(
      { ...request, originalUrl: '/internal/v1/auth/mfa/challenge' },
      operation,
    );

    const isAllowed = execute.mock.calls[0][1];

    expect(isAllowed(marketplaceIssuer)).toBe(false);
    expect(isAllowed(adminIssuer)).toBe(true);
  });

  it('rejects a path alias before calling admission', () => {
    const service = new InternalAuthHttpService(admission);

    expect(() =>
      service.execute(
        { ...request, originalUrl: '/internal/v1/auth/login?' },
        operation,
      ),
    ).toThrow(NotFoundException);
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects a missing Bearer header before calling admission', () => {
    const service = new InternalAuthHttpService(admission);

    expect(() =>
      service.execute({ ...request, rawHeaders: [] }, operation),
    ).toThrow(UnauthorizedException);
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns unavailable when both issuer settings are absent', () => {
    delete process.env.AUTH_MARKETPLACE_BFF_ISSUER;
    delete process.env.AUTH_ADMIN_BFF_ISSUER;
    const service = new InternalAuthHttpService(admission);

    expect(() => service.execute(request, operation)).toThrow(
      ServiceUnavailableException,
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects partial issuer configuration at construction', () => {
    delete process.env.AUTH_ADMIN_BFF_ISSUER;

    expect(() => new InternalAuthHttpService(admission)).toThrow(
      'Invalid BFF permission configuration.',
    );
  });

  it('preserves admission failures', async () => {
    const failure = new ServiceUnavailableException();
    execute.mockRejectedValueOnce(failure);
    const service = new InternalAuthHttpService(admission);

    await expect(service.execute(request, operation)).rejects.toBe(failure);
  });
});
