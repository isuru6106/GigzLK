import { describe, expect, it } from '@jest/globals';
import { VerificationRequestFingerprint } from './verification-request.fingerprint';
import type { VerificationRequest } from './verification-request';

describe('VerificationRequestFingerprint', () => {
  // Synthetic test keys only; separate from encryption keys.
  const oldKey = Buffer.alloc(32, 10);
  const currentKey = Buffer.alloc(32, 20);

  const request: VerificationRequest = {
    requestId: 'abcdef00-0000-4000-8000-000000000001',
    recipientEmail: 'synthetic@example.test',
    verificationUrl: 'https://marketplace.example.test/verify-email#test',
    expiresAt: '2026-11-23T12:30:00.000Z',
    templateId: 'email-verification-v1',
  };

  function createFingerprint() {
    return new VerificationRequestFingerprint(
      'current',
      new Map([
        ['old', oldKey],
        ['current', currentKey],
      ]),
    );
  }

  it('returns a stable 64-character hexadecimal fingerprint', () => {
    const fingerprints = createFingerprint();
    const first = fingerprints.calculate('auth-service', request);

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprints.calculate('auth-service', { ...request })).toBe(first);
  });

  it('does not depend on object property order', () => {
    const fingerprints = createFingerprint();

    const reordered: VerificationRequest = {
      templateId: request.templateId,
      expiresAt: request.expiresAt,
      verificationUrl: request.verificationUrl,
      recipientEmail: request.recipientEmail,
      requestId: request.requestId,
    };

    expect(fingerprints.calculate('auth-service', reordered)).toBe(
      fingerprints.calculate('auth-service', request),
    );
  });

  it.each([
    {
      requestId: 'abcdef00-0000-4000-8000-000000000002',
    },
    {
      recipientEmail: 'another@example.test',
    },
    {
      verificationUrl: 'https://marketplace.example.test/verify-email#another',
    },
    {
      expiresAt: '2026-11-23T13:00:00.000Z',
    },
  ])('detects changed request fields: %o', (change) => {
    const fingerprints = createFingerprint();

    expect(
      fingerprints.calculate('auth-service', { ...request, ...change }),
    ).not.toBe(fingerprints.calculate('auth-service', request));
  });

  it('binds the fingerprint to the caller', () => {
    const fingerprints = createFingerprint();

    expect(fingerprints.calculate('another-service', request)).not.toBe(
      fingerprints.calculate('auth-service', request),
    );
  });

  it('reproduces an old fingerprint after key rotation', () => {
    const previous = new VerificationRequestFingerprint(
      'old',
      new Map([['old', oldKey]]),
    );

    const original = previous.calculate('auth-service', request);
    const rotated = createFingerprint();

    expect(rotated.calculate('auth-service', request, 'old')).toBe(original);
    expect(rotated.calculate('auth-service', request)).not.toBe(original);
  });

  it('copies supplied keys to prevent later mutation', () => {
    const key = Buffer.alloc(32, 30);
    const fingerprints = new VerificationRequestFingerprint(
      'current',
      new Map([['current', key]]),
    );

    const original = fingerprints.calculate('auth-service', request);
    key.fill(0);

    expect(fingerprints.calculate('auth-service', request)).toBe(original);
  });

  it('rejects an unavailable key', () => {
    expect(() =>
      createFingerprint().calculate('auth-service', request, 'missing'),
    ).toThrow('Verification fingerprint key unavailable');
  });

  it('rejects invalid key lengths', () => {
    expect(
      () =>
        new VerificationRequestFingerprint(
          'current',
          new Map([['current', Buffer.alloc(16)]]),
        ),
    ).toThrow('Invalid verification fingerprint configuration');
  });

  it('requires the active key to exist', () => {
    expect(
      () => new VerificationRequestFingerprint('missing', new Map()),
    ).toThrow('Invalid verification fingerprint configuration');
  });

  it.each(['', ' auth-service', 'auth-service ', 'a'.repeat(101)])(
    'rejects an invalid caller',
    (callerId) => {
      expect(() => createFingerprint().calculate(callerId, request)).toThrow(
        'Invalid verification fingerprint caller',
      );
    },
  );
});
