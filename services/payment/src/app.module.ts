import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseService } from './database.service';
import { HealthController } from './health.controller';

@Module({
  imports: [],
  controllers: [AppController, HealthController],
  providers: [AppService, DatabaseService],
})
export class AppModule {}
