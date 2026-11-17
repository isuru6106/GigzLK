import { UnauthorizedException } from '@nestjs/common';
import { visit } from 'jsonc-parser';
import { ASSERTION_POLICY } from './assertion-policy';

export function parseAssertionJson(text: string): Record<string, unknown> {
  try {
    if (Buffer.byteLength(text, 'utf8') > ASSERTION_POLICY.maxPayloadBytes) {
      throw new Error();
    }

    const value: unknown = JSON.parse(text);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error();
    }

    const objectKeys: Set<string>[] = [];

    visit(
      text,
      {
        onObjectBegin: () => {
          objectKeys.push(new Set<string>());
        },
        onObjectProperty: (name) => {
          const keys = objectKeys[objectKeys.length - 1];
          if (!keys || keys.has(name)) {
            throw new Error();
          }
          keys.add(name);
        },
        onObjectEnd: () => {
          objectKeys.pop();
        },
        onError: () => {
          throw new Error();
        },
      },
      { disallowComments: true, allowTrailingComma: false },
    );

    return value as Record<string, unknown>;
  } catch {
    throw new UnauthorizedException({
      code: 'SERVICE_AUTH_INVALID',
      message: 'Service authentication is invalid.',
    });
  }
}
