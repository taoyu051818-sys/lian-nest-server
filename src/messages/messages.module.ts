import { Module } from '@nestjs/common';
import { MessagesController } from './controllers/messages.controller';
import { NotificationsController } from './controllers/notifications.controller';
import { MessagesUseCase } from './use-cases/messages.use-case';
import { NotificationsUseCase } from './use-cases/notifications.use-case';

@Module({
  controllers: [MessagesController, NotificationsController],
  providers: [MessagesUseCase, NotificationsUseCase],
  exports: [MessagesUseCase, NotificationsUseCase],
})
export class MessagesModule {}
