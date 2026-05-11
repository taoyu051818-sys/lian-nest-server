import { Controller, Get, Post, Param } from '@nestjs/common';
import { NotificationsUseCase } from '../use-cases/notifications.use-case';
import { NotificationListResponseDto } from '../dto/notification.dto';

@Controller('api/notifications')
export class NotificationsController {
  constructor(private readonly notificationsUseCase: NotificationsUseCase) {}

  @Get()
  async listNotifications(): Promise<NotificationListResponseDto> {
    // TODO: Extract uid from auth context (session/JWT)
    const uid = 0;
    return this.notificationsUseCase.listNotifications(uid);
  }

  @Get('unread-count')
  async getUnreadCount(): Promise<{ count: number }> {
    // TODO: Extract uid from auth context (session/JWT)
    const uid = 0;
    const count = await this.notificationsUseCase.getUnreadCount(uid);
    return { count };
  }

  @Post(':nid/read')
  async markRead(@Param('nid') nid: string): Promise<void> {
    // TODO: Extract uid from auth context (session/JWT)
    const uid = 0;
    return this.notificationsUseCase.markRead(uid, nid);
  }
}
