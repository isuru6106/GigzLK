import {
  Body,
  Controller,
  HttpCode,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { EmailVerificationService } from './email-verification.service';
import { VerifyEmailDto } from './verify-email.dto';

@Controller('api/v1/auth')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    validationError: { target: false, value: false },
  }),
)
export class EmailVerificationController {
  constructor(private readonly verification: EmailVerificationService) {}

  @Post('verify-email')
  @HttpCode(200)
  verify(@Body() input: VerifyEmailDto) {
    return this.verification.verify(input.token);
  }
}
