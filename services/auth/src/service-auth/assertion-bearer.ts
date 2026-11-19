import { UnauthorizedException } from '@nestjs/common';
import { ASSERTION_POLICY } from './assertion-policy';

export function extractServiceAssertion(rawHeaders: readonly string[]): string {
  let authorization: string | undefined;

  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index].toLowerCase() !== 'authorization') {
      continue;
    }

    if (authorization !== undefined) {
      invalid();
    }

    authorization = rawHeaders[index + 1];
  }

  if (
    authorization === undefined ||
    authorization.length > ASSERTION_POLICY.maxEncodedBytes + 7
  ) {
    invalid();
  }

  const match =
    /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(
      authorization,
    );

  if (!match) {
    invalid();
  }

  return match[1];
}

function invalid(): never {
  throw new UnauthorizedException({
    code: 'SERVICE_AUTH_INVALID',
    message: 'Service authentication is invalid.',
  });
}
