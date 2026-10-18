import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get('live')
  live() {
    return { status: 'UP', service: 'payment' };
  }

  @Get('ready')
  ready() {
    return { status: 'UP', service: 'payment' };
  }
}
