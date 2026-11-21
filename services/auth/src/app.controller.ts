import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from './database.service';

@Controller('health')
export class AppController {
  constructor(
    @Inject(DatabaseService)
    private readonly database: Pick<DatabaseService, 'checkReadiness'>,
  ) {}

  @Get('live')
  live() {
    return { status: 'UP', service: 'auth' };
  }

  @Get('ready')
  async ready() {
    try {
      await this.database.checkReadiness();
      return { status: 'UP', service: 'auth' };
    } catch {
      throw new ServiceUnavailableException({
        status: 'DOWN',
        service: 'auth',
      });
    }
  }
}
