import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
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

  async getUnreadCount(uid: number): Promise<{ count: number; fallback: boolean }> {
    void uid;
    const auth = { mode: NodebbAuthMode.NONE };
    const res = await this.notificationsProvider.list(auth);

    if (res.status !== BodyStatus.OK || !res.data) {
      return { count: 0, fallback: true };
    }

    const count = res.data.filter((n) => !n.read).length;
    return { count, fallback: false };
  }

  async markRead(uid: number, nid: string): Promise<void> {
    if (!nid || !nid.trim()) {
      throw new BadRequestException('nid is required');
    }

    void uid;
    const auth = { mode: NodebbAuthMode.NONE };
    const res = await this.notificationsProvider.markRead(nid, auth);

    if (res.status === BodyStatus.NOT_FOUND) {
      throw new NotFoundException(`Notification ${nid} not found`);
    }

    if (res.status !== BodyStatus.OK) {
      throw new Error(res.error ?? 'Failed to mark notification as read');
    }
  }
}
