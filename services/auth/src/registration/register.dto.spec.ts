import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { RegisterDto } from './register.dto';

describe('RegisterDto validation', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    validationError: { target: false, value: false },
  });

  const validate = (value: unknown): Promise<RegisterDto> =>
    pipe.transform(value, {
      type: 'body',
      metatype: RegisterDto,
    }) as Promise<RegisterDto>;

  const valid = {
    email: 'worker@example.com',
    password: 'a-long-test-password',
  };

  it('trims email and preserves the exact password', async () => {
    const result = await validate({
      email: ' Worker@example.com ',
      password: '  a-long-test-password  ',
    });

    expect(result.email).toBe('Worker@example.com');
    expect(result.password).toBe('  a-long-test-password  ');
  });

  it.each([
    { ...valid, email: 'invalid' },
    { ...valid, email: 123 },
    { ...valid, password: 123 },
    { ...valid, password: 'too-short' },
    { ...valid, password: 'x'.repeat(129) },
    { ...valid, role: 'ADMIN' },
    { ...valid, status: 'ACTIVE' },
    { email: valid.email },
    { password: valid.password },
  ])('rejects invalid or unexpected input %#', async (input) => {
    await expect(validate(input)).rejects.toBeInstanceOf(BadRequestException);
  });
});
