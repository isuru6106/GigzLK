import { ForbiddenException, Injectable } from '@nestjs/common';
import { AssertionKeysService } from './assertion-keys.service';
import { AssertionReplayService } from './assertion-replay.service';
import { validateAssertionTiming } from './assertion-timing';

@Injectable()
export class AssertionAdmissionService {
  constructor(
    private readonly keys: AssertionKeysService,
    private readonly replay: AssertionReplayService,
  ) {}

  async execute<T>(
    token: string,
    isAllowed: (issuer: string) => boolean,
    operation: (issuer: string) => T | Promise<T>,
  ): Promise<T> {
    const { issuer, jti, issuedAt, expiresAt } = this.keys.validate(token);

    if (!isAllowed(issuer)) {
      throw new ForbiddenException({
        code: 'SERVICE_ACCESS_DENIED',
        message: 'Service access is denied.',
      });
    }

    await this.replay.consume(issuer, jti, new Date(expiresAt * 1000));

    validateAssertionTiming(issuedAt, expiresAt);

    return operation(issuer);
  }
}
