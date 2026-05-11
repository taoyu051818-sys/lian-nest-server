import { Module } from '@nestjs/common';
import { NodebbModule, NodebbNotificationsProvider, NodebbAuthMode } from '../nodebb';
import { MessagesController } from './controllers/messages.controller';
import { NotificationsController } from './controllers/notifications.controller';
import { MessagesUseCase } from './use-cases/messages.use-case';
import { NotificationsUseCase } from './use-cases/notifications.use-case';

@Module({
  imports: [
    NodebbModule.register({
      baseUrl: process.env.NODEBB_URL ?? '',
      authMode: (process.env.NODEBB_AUTH_MODE as NodebbAuthMode) ?? NodebbAuthMode.NONE,
    }),
  ],
  controllers: [MessagesController, NotificationsController],
  providers: [MessagesUseCase, NotificationsUseCase],
  exports: [MessagesUseCase, NotificationsUseCase],
})
export class MessagesModule {}
