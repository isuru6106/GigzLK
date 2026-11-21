import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CredentialsDto } from './credentials.dto';

describe('CredentialsDto', () => {
  it('trims email and preserves the exact password', async () => {
    const input = plainToInstance(CredentialsDto, {
      email: ' Worker@Example.com ',
      password: '  exact password  ',
    });

    expect(await validate(input)).toHaveLength(0);
    expect(input.email).toBe('Worker@Example.com');
    expect(input.password).toBe('  exact password  ');
  });

  it('accepts a nonempty password without applying registration minimum length', async () => {
    const input = plainToInstance(CredentialsDto, {
      email: 'worker@example.com',
      password: 'x',
    });

    expect(await validate(input)).toHaveLength(0);
  });

  it.each([
    {},
    { email: null, password: 'password' },
    { email: 123, password: 'password' },
    { email: 'invalid-email', password: 'password' },
    { email: 'wörker@example.com', password: 'password' },
    { email: 'worker@example.com', password: null },
    { email: 'worker@example.com', password: 123 },
    { email: 'worker@example.com', password: '' },
    { email: 'worker@example.com', password: 'x'.repeat(129) },
  ])('rejects invalid input %#', async (body) => {
    const input = plainToInstance(CredentialsDto, body);
    expect((await validate(input)).length).toBeGreaterThan(0);
  });
});
