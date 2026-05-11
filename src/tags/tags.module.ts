import { Module } from '@nestjs/common';
import { NodebbModule } from '../nodebb/nodebb.module';
import { toNodebbAuthMode } from '../nodebb/types';
import { TagsController } from './tags.controller';
import { TagsUsecase } from './tags.usecase';

@Module({
  imports: [
    NodebbModule.register({
      baseUrl: process.env.NODEBB_URL || 'http://localhost:4567',
      authMode: toNodebbAuthMode(process.env.NODEBB_AUTH_MODE ?? 'none'),
      apiToken: process.env.NODEBB_API_TOKEN,
      sessionCookie: process.env.NODEBB_SESSION_COOKIE,
    }),
  ],
  controllers: [TagsController],
  providers: [TagsUsecase],
  exports: [TagsUsecase],
})
export class TagsModule {}
