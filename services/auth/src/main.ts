import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { resolvePort } from './config';

async function bootstrap() {
  const port = resolvePort(process.env.PORT);
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(port);
}

bootstrap().catch(() => {
  Logger.error(
    'Auth startup failed; check configuration and port availability',
    'Bootstrap',
  );
  process.exitCode = 1;
});
