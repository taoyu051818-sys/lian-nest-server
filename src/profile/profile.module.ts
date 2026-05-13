import { Module } from '@nestjs/common';
import { ConfigService } from '../config';
import { NodebbModule } from '../nodebb/nodebb.module';
import { toNodebbAuthMode } from '../nodebb/types';
import { ProfileController } from './profile.controller';
import { ProfileUsecase } from './profile.usecase';

@Module({
  imports: [
    NodebbModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        baseUrl: config.nodebbConfig.url || 'http://localhost:4567',
        authMode: toNodebbAuthMode(config.nodebbConfig.authMode || 'none'),
        apiToken: config.nodebbConfig.apiToken || undefined,
        sessionCookie: config.nodebbConfig.sessionCookie || undefined,
      }),
    }),
  ],
  controllers: [ProfileController],
  providers: [ProfileUsecase],
  exports: [ProfileUsecase],
})
export class ProfileModule {}
