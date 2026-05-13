import { Module } from '@nestjs/common';
import { ConfigService } from '../config';
import { NodebbModule, NodebbNotificationsProvider, toNodebbAuthMode } from '../nodebb';
import { MessagesController } from './controllers/messages.controller';
import { NotificationsController } from './controllers/notifications.controller';
import { MessagesUseCase } from './use-cases/messages.use-case';
import { NotificationsUseCase } from './use-cases/notifications.use-case';

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
  controllers: [MessagesController, NotificationsController],
  providers: [MessagesUseCase, NotificationsUseCase],
  exports: [MessagesUseCase, NotificationsUseCase],
})
export class MessagesModule {}
