import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseService } from './database.service';
import { HealthController } from './health.controller';
import { PaymentRepository } from './payments/payment.repository';
import { PaymentReleaseService } from './payments/payment-release.service';

@Module({
  imports: [],
  controllers: [AppController, HealthController],
  providers: [
    AppService,
    DatabaseService,
    PaymentRepository,
    PaymentReleaseService,
  ],
})
export class AppModule {}
