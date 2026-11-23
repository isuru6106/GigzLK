import { describe, expect, it } from '@jest/globals';
import {
  canStartVerificationDelivery,
  InvalidVerificationRequestError,
  validateVerificationRequest,
} from './verification-request';

describe('Email verification request validation', () => {
  const requestId = 'abcdef00-0000-4000-8000-000000000001';

  const policy = {
    origin: 'https://marketplace.example.test',
    pathname: '/verify-email',
  };

  const valid = {
    requestId,
    recipientEmail: 'synthetic@example.test',
    verificationUrl:
      'https://marketplace.example.test/verify-email#synthetic-token',
    expiresAt: '2026-11-23T12:30:00.000Z',
    templateId: 'email-verification-v1',
  };

  it('accepts valid synthetic input without mutating it', () => {
    const input = Object.freeze({ ...valid });

    expect(validateVerificationRequest(input, requestId, policy)).toEqual(
      valid,
    );
  });

  it('normalizes UUID casing consistently', () => {
    expect(
      validateVerificationRequest(
        { ...valid, requestId: requestId.toUpperCase() },
        requestId,
        policy,
      ).requestId,
    ).toBe(requestId);
  });

  it.each([
    null,
    [],
    'invalid',
    {},
    { ...valid, unexpected: true },
    { ...valid, requestId: 'invalid' },
    { ...valid, recipientEmail: 'invalid' },
    { ...valid, recipientEmail: 'a@example.test\r\nBcc: other@example.test' },
    { ...valid, templateId: 'unknown-template' },
    { ...valid, expiresAt: 'invalid' },
    { ...valid, expiresAt: '2026-11-23T12:30:00Z' },
    { ...valid, expiresAt: '2026-02-30T12:30:00.000Z' },
  ])('rejects invalid input case %#', (input) => {
    expect(() => validateVerificationRequest(input, requestId, policy)).toThrow(
      InvalidVerificationRequestError,
    );
  });

  it('rejects a missing required field', () => {
    const { expiresAt, ...input } = valid;
    void expiresAt;

    expect(() => validateVerificationRequest(input, requestId, policy)).toThrow(
      InvalidVerificationRequestError,
    );
  });

  it.each([undefined, '', 'invalid', '00000000-0000-4000-8000-000000000002'])(
    'rejects invalid or mismatched idempotency key case %#',
    (key) => {
      expect(() => validateVerificationRequest(valid, key, policy)).toThrow(
        InvalidVerificationRequestError,
      );
    },
  );

  it.each([
    'http://marketplace.example.test/verify-email#token',
    'https://other.example.test/verify-email#token',
    'https://marketplace.example.test/other#token',
    'https://marketplace.example.test/verify-email?token=secret',
    'https://user:password@marketplace.example.test/verify-email#token',
    'https://marketplace.example.test:444/verify-email#token',
    'https://marketplace.example.test/verify-email#token with spaces',
    'https://marketplace.example.test\\verify-email#token',
    'not-a-url',
  ])('rejects disallowed URL case %#', (verificationUrl) => {
    expect(() =>
      validateVerificationRequest(
        { ...valid, verificationUrl },
        requestId,
        policy,
      ),
    ).toThrow(InvalidVerificationRequestError);
  });

  it('does not apply the delivery cutoff during field validation', () => {
    const expired = {
      ...valid,
      expiresAt: '2020-01-01T00:00:00.000Z',
    };

    expect(validateVerificationRequest(expired, requestId, policy)).toEqual(
      expired,
    );
  });

  it('does not expose request contents through validation errors', () => {
    try {
      validateVerificationRequest(
        { ...valid, templateId: 'invalid' },
        requestId,
        policy,
      );

      throw new Error('Expected validation failure');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidVerificationRequestError);
      expect((error as Error).message).toBe(
        'Invalid email verification request',
      );
    }
  });
});

describe('Verification delivery cutoff', () => {
  const expiresAt = '2026-11-23T12:30:00.000Z';

  it('allows an attempt one millisecond before the cutoff', () => {
    expect(
      canStartVerificationDelivery(
        expiresAt,
        new Date('2026-11-23T12:27:59.999Z'),
      ),
    ).toBe(true);
  });

  it('blocks an attempt exactly at the cutoff', () => {
    expect(
      canStartVerificationDelivery(
        expiresAt,
        new Date('2026-11-23T12:28:00.000Z'),
      ),
    ).toBe(false);
  });

  it('blocks attempts after the cutoff and after expiry', () => {
    for (const now of [
      '2026-11-23T12:29:00.000Z',
      '2026-11-23T12:30:00.000Z',
      '2026-11-23T12:31:00.000Z',
    ]) {
      expect(canStartVerificationDelivery(expiresAt, new Date(now))).toBe(
        false,
      );
    }
  });

  it('rejects invalid time values', () => {
    expect(canStartVerificationDelivery('invalid', new Date())).toBe(false);

    expect(canStartVerificationDelivery(expiresAt, new Date('invalid'))).toBe(
      false,
    );
  });
});
