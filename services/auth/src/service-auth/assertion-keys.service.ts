import { Injectable } from '@nestjs/common';
import { loadTrustedAssertionIssuers } from './assertion-key-config';
import {
  validateServiceAssertion,
  type TrustedAssertionIssuer,
} from './assertion-validator';

@Injectable()
export class AssertionKeysService {
  private readonly trustedIssuers: ReadonlyMap<string, TrustedAssertionIssuer>;

  constructor() {
    const filePath = process.env.AUTH_ASSERTION_KEYS_FILE;
    this.trustedIssuers =
      filePath === undefined
        ? new Map()
        : loadTrustedAssertionIssuers(filePath);
  }

  validate(token: string) {
    return validateServiceAssertion(token, this.trustedIssuers);
  }
}
