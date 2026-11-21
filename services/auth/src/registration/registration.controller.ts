import {
  Body,
  Controller,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { RegisterDto } from './register.dto';
import { RegistrationService } from './registration.service';

@Controller('api/v1/auth')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    validationError: { target: false, value: false },
  }),
)
export class RegistrationController {
  constructor(private readonly registration: RegistrationService) {}

  @Post('register')
  register(@Body() input: RegisterDto) {
    return this.registration.register(input);
  }
}
