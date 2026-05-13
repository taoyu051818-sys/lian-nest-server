import { Module } from '@nestjs/common';
import { ConfigService } from '../config';
import { NodebbModule } from '../nodebb/nodebb.module';
import { NodebbGroupsProvider } from '../nodebb/providers/nodebb-groups.provider';
import { toNodebbAuthMode } from '../nodebb/types';
import { GroupsController } from './groups.controller';
import { GroupsUsecase } from './groups.usecase';

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
  controllers: [GroupsController],
  providers: [NodebbGroupsProvider, GroupsUsecase],
  exports: [GroupsUsecase],
})
export class GroupsModule {}
