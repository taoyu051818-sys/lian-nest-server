import { Module } from '@nestjs/common';
import { NodebbModule, NodebbNotificationsProvider, toNodebbAuthMode } from '../nodebb';
import { MessagesController } from './controllers/messages.controller';
import { NotificationsController } from './controllers/notifications.controller';
import { MessagesUseCase } from './usecases/messages.usecase';
import { NotificationsUseCase } from './usecases/notifications.usecase';

@Module({
  imports: [
    NodebbModule.register({
      baseUrl: process.env.NODEBB_URL || 'http://localhost:4567',
      authMode: toNodebbAuthMode(process.env.NODEBB_AUTH_MODE ?? 'none'),
    }),
  ],
  controllers: [MessagesController, NotificationsController],
  providers: [MessagesUseCase, NotificationsUseCase],
  exports: [MessagesUseCase, NotificationsUseCase],
})
export class MessagesModule {}
