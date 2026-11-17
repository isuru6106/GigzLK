export const ASSERTION_POLICY = {
  algorithm: 'RS256',
  tokenType: 'gigzlk-service-assertion+jwt',
  maxEncodedBytes: 4096,
  maxHeaderBytes: 512,
  maxPayloadBytes: 2048,
  maxLifetimeSeconds: 60,
  clockLeewaySeconds: 5,
  maxAgeSeconds: 65,
} as const;

export const ASSERTION_KID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const ASSERTION_JTI_PATTERN = /^[0-9a-f]{32}$/;
