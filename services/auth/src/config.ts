export function resolvePort(value: string | undefined): number {
  if (value === undefined) {
    return 3006;
  }

  if (!/^[0-9]+$/.test(value)) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  return port;
}
