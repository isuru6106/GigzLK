import { CredentialsService } from './credentials/credentials.service';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { DatabaseService } from './database.service';
import { EmailVerificationController } from './email-verification/email-verification.controller';
import { EmailVerificationService } from './email-verification/email-verification.service';
import { RegistrationController } from './registration/registration.controller';
import { RegistrationService } from './registration/registration.service';

@Module({
  controllers: [
    AppController,
    RegistrationController,
    EmailVerificationController,
  ],
  providers: [
    CredentialsService,
    DatabaseService,
    RegistrationService,
    EmailVerificationService,
  ],
})
export class AppModule {}
