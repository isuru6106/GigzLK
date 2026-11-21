import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { CredentialsService } from './credentials/credentials.service';
import { DatabaseService } from './database.service';
import { EmailVerificationController } from './email-verification/email-verification.controller';
import { EmailVerificationService } from './email-verification/email-verification.service';
import { RegistrationController } from './registration/registration.controller';
import { RegistrationService } from './registration/registration.service';
import { AssertionAdmissionService } from './service-auth/assertion-admission.service';
import { AssertionKeysService } from './service-auth/assertion-keys.service';
import { AssertionReplayService } from './service-auth/assertion-replay.service';
import { InternalAuthHttpService } from './service-auth/internal-auth-http.service';
import { MarketplaceSessionService } from './sessions/marketplace-session.service';
import { AccessSigningKeyService } from './access-tokens/access-signing-key.service';
import { AccessJwksController } from './access-tokens/access-jwks.controller';

@Module({
  controllers: [
    AppController,
    RegistrationController,
    EmailVerificationController,
    AccessJwksController,
  ],

  providers: [
    AccessSigningKeyService,
    CredentialsService,
    InternalAuthHttpService,
    DatabaseService,
    RegistrationService,
    EmailVerificationService,
    AssertionAdmissionService,
    AssertionReplayService,
    AssertionKeysService,
    MarketplaceSessionService,
  ],
})
export class AppModule {}
