import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { DatabaseService } from './database.service';
import { RegistrationController } from './registration/registration.controller';
import { RegistrationService } from './registration/registration.service';

@Module({
  controllers: [AppController, RegistrationController],
  providers: [DatabaseService, RegistrationService],
})
export class AppModule {}
