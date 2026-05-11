import { Injectable } from '@nestjs/common';
import { NotificationListResponseDto, NotificationResponseDto } from '../dto/notification.dto';

@Injectable()
export class NotificationsUseCase {
  /**
   * List notifications for a user.
   * TODO: Delegate to NodebbNotificationsProvider.list() when auth mode is resolved.
   */
  async listNotifications(uid: number): Promise<NotificationListResponseDto> {
    void uid;
    throw new Error('Not implemented: NotificationsUseCase.listNotifications — awaiting auth mode resolution');
  }

  /**
   * Mark a notification as read.
   * TODO: Delegate to NodebbNotificationsProvider.markRead() when auth mode is resolved.
   */
  async markRead(uid: number, nid: string): Promise<void> {
    void uid;
    void nid;
    throw new Error('Not implemented: NotificationsUseCase.markRead — awaiting auth mode resolution');
  }

  /**
   * Get unread notification count.
   * TODO: Implement when notification parity is defined.
   */
  async getUnreadCount(uid: number): Promise<number> {
    void uid;
    throw new Error('Not implemented: NotificationsUseCase.getUnreadCount — awaiting notification parity definition');
  }
}
