import { Module } from '@nestjs/common';
import { NodebbModule } from '../nodebb/nodebb.module';
import { NodebbGroupsProvider } from '../nodebb/providers/nodebb-groups.provider';
import { toNodebbAuthMode } from '../nodebb/types';
import { GroupsController } from './groups.controller';
import { GroupsUsecase } from './groups.usecase';

@Module({
  imports: [
    NodebbModule.register({
      baseUrl: process.env.NODEBB_URL || 'http://localhost:4567',
      authMode: toNodebbAuthMode(process.env.NODEBB_AUTH_MODE ?? 'none'),
      apiToken: process.env.NODEBB_API_TOKEN,
      sessionCookie: process.env.NODEBB_SESSION_COOKIE,
    }),
  ],
  controllers: [GroupsController],
  providers: [NodebbGroupsProvider, GroupsUsecase],
  exports: [GroupsUsecase],
})
export class GroupsModule {}
