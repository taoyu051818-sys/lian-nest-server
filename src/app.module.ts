import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from './config';
import { HealthModule } from './health';
import { NodebbModule } from './nodebb';
import { toNodebbAuthMode } from './nodebb/types';

@Module({
  imports: [
    ConfigModule,
    HealthModule,
    NodebbModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        baseUrl: config.nodebbConfig.url,
        authMode: toNodebbAuthMode(config.nodebbConfig.authMode),
        apiToken: config.nodebbConfig.apiToken || undefined,
        sessionCookie: config.nodebbConfig.sessionCookie || undefined,
      }),
    }),
  ],
})
export class AppModule {}
