export interface VerificationRequest {
  requestId: string;
  recipientEmail: string;
  verificationUrl: string;
  expiresAt: string;
  templateId: 'email-verification-v1';
}

export interface VerificationUrlPolicy {
  origin: string;
  pathname: string;
}

export class InvalidVerificationRequestError extends Error {
  constructor() {
    super('Invalid email verification request');
    this.name = 'InvalidVerificationRequestError';
  }
}

export function validateVerificationRequest(
  input: unknown,
  idempotencyKey: unknown,
  policy: VerificationUrlPolicy,
): VerificationRequest {
  const invalid = () => new InvalidVerificationRequestError();

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw invalid();
  }

  const fields = [
    'requestId',
    'recipientEmail',
    'verificationUrl',
    'expiresAt',
    'templateId',
  ];

  if (
    Object.keys(input).length !== fields.length ||
    !fields.every((field) => Object.hasOwn(input, field))
  ) {
    throw invalid();
  }

  const value = input as Record<string, unknown>;
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (
    typeof value.requestId !== 'string' ||
    !uuidPattern.test(value.requestId) ||
    typeof idempotencyKey !== 'string' ||
    !uuidPattern.test(idempotencyKey) ||
    value.requestId.toLowerCase() !== idempotencyKey.toLowerCase() ||
    typeof value.recipientEmail !== 'string' ||
    value.recipientEmail.length > 254 ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(
      value.recipientEmail,
    ) ||
    typeof value.verificationUrl !== 'string' ||
    value.verificationUrl.length > 2048 ||
    /[\s\\]/.test(value.verificationUrl) ||
    typeof value.expiresAt !== 'string' ||
    value.templateId !== 'email-verification-v1'
  ) {
    throw invalid();
  }

  const expiry = new Date(value.expiresAt);

  if (
    !Number.isFinite(expiry.getTime()) ||
    expiry.toISOString() !== value.expiresAt
  ) {
    throw invalid();
  }

  let url: URL;
  let configuredOrigin: URL;

  try {
    url = new URL(value.verificationUrl);
    configuredOrigin = new URL(policy.origin);
  } catch {
    throw invalid();
  }

  if (
    configuredOrigin.origin !== policy.origin ||
    url.protocol !== 'https:' ||
    url.origin !== configuredOrigin.origin ||
    url.pathname !== policy.pathname ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== ''
  ) {
    throw invalid();
  }

  return {
    requestId: value.requestId.toLowerCase(),
    recipientEmail: value.recipientEmail,
    verificationUrl: value.verificationUrl,
    expiresAt: expiry.toISOString(),
    templateId: 'email-verification-v1',
  };
}

export function canStartVerificationDelivery(
  expiresAt: string,
  now: Date,
): boolean {
  const expiry = Date.parse(expiresAt);
  const current = now.getTime();

  return (
    Number.isFinite(expiry) &&
    Number.isFinite(current) &&
    current < expiry - 120_000
  );
}
