import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from './database.service';

@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  @Get('live')
  live() {
    return { status: 'UP', service: 'payment' };
  }

  @Get('ready')
  async ready() {
    try {
      await this.database.checkReadiness();
    } catch {
      throw new ServiceUnavailableException({
        status: 'DOWN',
        service: 'payment',
      });
    }

    return { status: 'UP', service: 'payment' };
  }
}
