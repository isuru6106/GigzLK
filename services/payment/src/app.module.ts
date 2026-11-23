import { Module } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseService } from './database.service';
import { HealthController } from './health.controller';
import {
  PaymentAssignmentClient,
  PaymentCompletionClient,
  PaymentSessionClient,
} from './payments/payment-access.clients';
import { PaymentController } from './payments/payment.controller';
import { PaymentNoStoreMiddleware } from './payments/payment-no-store.middleware';
import { PaymentReadService } from './payments/payment-read.service';
import { PaymentReleaseService } from './payments/payment-release.service';
import { PaymentRepository } from './payments/payment.repository';
import { PaymentApprovalRepository } from './payments/payment-approval.repository';
import { PaymentApprovalService } from './payments/payment-approval.service';

@Module({
  imports: [],
  controllers: [AppController, HealthController, PaymentController],
  providers: [
    AppService,
    DatabaseService,
    PaymentRepository,
    PaymentReleaseService,
    PaymentSessionClient,
    PaymentAssignmentClient,
    PaymentCompletionClient,
    PaymentApprovalRepository,
    PaymentApprovalService,
    PaymentReadService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(PaymentNoStoreMiddleware).forRoutes(PaymentController);
  }
}
