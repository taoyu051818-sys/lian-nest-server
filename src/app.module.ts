import { Module } from '@nestjs/common';
import { ConfigModule } from './config';
import { HealthModule } from './health';

@Module({
  imports: [ConfigModule, HealthModule],
})
export class AppModule {}
