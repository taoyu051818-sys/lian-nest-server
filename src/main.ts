import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common';
import { ConfigService } from './config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalFilters(new GlobalExceptionFilter());

  const config = app.get(ConfigService);
  await app.listen(config.port);

  console.log(`LIAN server listening on :${config.port} [${config.nodeEnv}]`);
}
bootstrap();
