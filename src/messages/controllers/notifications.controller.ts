import { Controller, Get, Post, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { NotificationsUseCase } from '../use-cases/notifications.use-case';
import { NotificationListResponseDto } from '../dto/notification.dto';

@Controller('api/notifications')
export class NotificationsController {
  constructor(private readonly notificationsUseCase: NotificationsUseCase) {}

  @Get()
  async listNotifications(
    @Query('page') page = '1',
    @Query('perPage') perPage = '20',
  ): Promise<NotificationListResponseDto> {
    // TODO: Extract uid from auth context (session/JWT)
    const uid = 0;
    return this.notificationsUseCase.listNotifications(
      uid,
    );
  }

  @Get('unread-count')
  async getUnreadCount(
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ count: number }> {
    // TODO: Extract uid from auth context (session/JWT)
    const uid = 0;
    const result = await this.notificationsUseCase.getUnreadCount(uid);
    if (result.fallback) {
      res.set('X-Fallback', 'true');
    }
    return { count: result.count };
  }

  @Post(':nid/read')
  async markRead(@Param('nid') nid: string): Promise<void> {
    // TODO: Extract uid from auth context (session/JWT)
    const uid = 0;
    return this.notificationsUseCase.markRead(uid, nid);
  }
}
