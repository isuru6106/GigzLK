import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class AppController {
  @Get('live')
  live() {
    return { status: 'UP', service: 'auth' };
  }

  @Get('ready')
  ready() {
    return { status: 'UP', service: 'auth' };
  }
}
