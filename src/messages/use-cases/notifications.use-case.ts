import { Injectable } from '@nestjs/common';
import {
  NodebbNotificationsProvider,
  NodebbAuthMode,
  BodyStatus,
} from '../../nodebb';
import {
  NotificationListResponseDto,
  NotificationResponseDto,
} from '../dto/notification.dto';

@Injectable()
export class NotificationsUseCase {
  constructor(
    private readonly notificationsProvider: NodebbNotificationsProvider,
  ) {}

  async listNotifications(uid: number): Promise<NotificationListResponseDto> {
    void uid;
    // TODO: Build NodebbAuth from request context when auth actor is implemented
    const auth = { mode: NodebbAuthMode.NONE };
    const res = await this.notificationsProvider.list(auth);

    if (res.status !== BodyStatus.OK || !res.data) {
      return { notifications: [], totalCount: 0 };
    }

    return {
      notifications: res.data.map(
        (n): NotificationResponseDto => ({
          nid: n.nid,
          type: n.type,
          bodyShort: n.bodyShort,
          bodyLong: n.bodyLong,
          fromUid: n.nidFrom,
          datetime: n.datetime,
          read: n.read,
        }),
      ),
      totalCount: res.data.length,
    };
  }

  async getUnreadCount(uid: number): Promise<number> {
    void uid;
    // TODO: Implement when notification parity is defined.
    // Delegate to NodebbNotificationsProvider when unread-count endpoint is available.
    return 0;
  }

  /**
   * Mark a notification as read.
   * TODO: Delegate to NodebbNotificationsProvider.markRead() when auth mode is resolved.
   */
  async markRead(uid: number, nid: string): Promise<void> {
    void uid;
    void nid;
    throw new Error(
      'Not implemented: NotificationsUseCase.markRead — read-only slice; writes deferred',
    );
  }
}
