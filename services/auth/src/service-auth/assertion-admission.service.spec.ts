import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { AssertionAdmissionService } from './assertion-admission.service';
import { AssertionKeysService } from './assertion-keys.service';
import { AssertionReplayService } from './assertion-replay.service';

describe('AssertionAdmissionService', () => {
  const claims = {
    issuer: 'urn:gigzlk:local:bff:marketplace',
    jti: 'a'.repeat(32),
    issuedAt: 1000,
    expiresAt: 1060,
  };

  let moduleRef: TestingModule;
  let service: AssertionAdmissionService;

  const validate = jest.fn(() => claims);
  const consume = jest.fn<Promise<void>, [string, string, Date]>();
  const isAllowed = jest.fn<boolean, [string]>();
  const operation = jest.fn<string, [string]>();

  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    validate.mockReset().mockReturnValue(claims);
    consume.mockReset().mockResolvedValue(undefined);
    isAllowed.mockReset().mockReturnValue(true);
    operation.mockReset().mockReturnValue('completed');

    moduleRef = await Test.createTestingModule({
      providers: [
        AssertionAdmissionService,
        { provide: AssertionKeysService, useValue: { validate } },
        { provide: AssertionReplayService, useValue: { consume } },
      ],
    }).compile();

    service = moduleRef.get(AssertionAdmissionService);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await moduleRef.close();
  });

  it('waits for replay consumption before running the operation', async () => {
    let finishConsumption: () => void = () => {
      throw new Error('Replay consumption did not start');
    };
    consume.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishConsumption = resolve;
      }),
    );

    const result = service.execute('token', isAllowed, operation);

    expect(isAllowed).toHaveBeenCalledWith(claims.issuer);
    expect(consume).toHaveBeenCalledWith(
      claims.issuer,
      claims.jti,
      new Date(1_060_000),
    );
    expect(operation).not.toHaveBeenCalled();

    finishConsumption();

    await expect(result).resolves.toBe('completed');
    expect(operation).toHaveBeenCalledTimes(1);
    expect(operation).toHaveBeenCalledWith(claims.issuer);
  });

  it('does not check permissions or write a replay record for an invalid assertion', async () => {
    validate.mockImplementationOnce(() => {
      throw new UnauthorizedException();
    });

    await expect(
      service.execute('token', isAllowed, operation),
    ).rejects.toThrow(UnauthorizedException);
    expect(isAllowed).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
    expect(operation).not.toHaveBeenCalled();
  });

  it('does not write a replay record when permission is denied', async () => {
    isAllowed.mockReturnValueOnce(false);

    await expect(
      service.execute('token', isAllowed, operation),
    ).rejects.toThrow(ForbiddenException);
    expect(consume).not.toHaveBeenCalled();
    expect(operation).not.toHaveBeenCalled();
  });

  it.each([new UnauthorizedException(), new ServiceUnavailableException()])(
    'does not run the operation if replay storage rejects the request: %s',
    async (error) => {
      consume.mockRejectedValueOnce(error);

      await expect(service.execute('token', isAllowed, operation)).rejects.toBe(
        error,
      );
      expect(operation).not.toHaveBeenCalled();
    },
  );

  it('rejects at the final expiry boundary after replay consumption succeeds', async () => {
    consume.mockImplementationOnce(() => {
      jest.spyOn(Date, 'now').mockReturnValue(1_065_000);
      return Promise.resolve();
    });

    await expect(
      service.execute('token', isAllowed, operation),
    ).rejects.toThrow(UnauthorizedException);
    expect(consume).toHaveBeenCalledTimes(1);
    expect(operation).not.toHaveBeenCalled();
  });
});
