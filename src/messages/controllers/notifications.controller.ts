import { Controller, Get, Post, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { NotificationsUseCase } from '../use-cases/notifications.use-case';
import { NotificationListResponseDto } from '../dto/notification.dto';
import { JwtAuthGuard, CurrentUser } from '../../auth';

@Controller('api/notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsUseCase: NotificationsUseCase) {}

  @Get()
  async listNotifications(
    @CurrentUser('sub') uid: number,
    @Query('page') page = '1',
    @Query('perPage') perPage = '20',
  ): Promise<NotificationListResponseDto> {
    return this.notificationsUseCase.listNotifications(
      uid,
    );
  }

  @Get('unread-count')
  async getUnreadCount(
    @CurrentUser('sub') uid: number,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ count: number }> {
    const result = await this.notificationsUseCase.getUnreadCount(uid);
    if (result.fallback) {
      res.set('X-Fallback', 'true');
    }
    return { count: result.count };
  }

  @Post(':nid/read')
  async markRead(
    @CurrentUser('sub') uid: number,
    @Param('nid') nid: string,
  ): Promise<void> {
    return this.notificationsUseCase.markRead(uid, nid);
  }
}
