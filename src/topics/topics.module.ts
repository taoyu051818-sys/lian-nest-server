import { Module } from '@nestjs/common';
import { NodebbModule } from '../nodebb/nodebb.module';
import { toNodebbAuthMode } from '../nodebb/types';
import { TopicsController } from './topics.controller';
import { TopicsUsecase } from './topics.usecase';

@Module({
  imports: [
    NodebbModule.register({
      baseUrl: process.env.NODEBB_URL || 'http://localhost:4567',
      authMode: toNodebbAuthMode(process.env.NODEBB_AUTH_MODE ?? 'none'),
      apiToken: process.env.NODEBB_API_TOKEN,
      sessionCookie: process.env.NODEBB_SESSION_COOKIE,
    }),
  ],
  controllers: [TopicsController],
  providers: [TopicsUsecase],
  exports: [TopicsUsecase],
})
export class TopicsModule {}
