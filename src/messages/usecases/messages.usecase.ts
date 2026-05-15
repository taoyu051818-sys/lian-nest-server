import { Injectable } from '@nestjs/common';
import { NodebbChatsProvider } from '../../nodebb/providers/nodebb-chats.provider';
import { CreateMessageDto, MessageResponseDto, MessageListResponseDto } from '../dto/message.dto';

@Injectable()
export class MessagesUseCase {
  constructor(private readonly chatsProvider: NodebbChatsProvider) {}

  /**
   * Send a message from one user to another.
   * If roomId is provided, sends to that existing room.
   * Otherwise, creates a new chat room with the target user.
   */
  async sendMessage(fromUid: number, dto: CreateMessageDto): Promise<MessageResponseDto> {
    if (dto.roomId) {
      const result = await this.chatsProvider.send(dto.roomId, dto.content, dto.toUid);
      const msg = result.data;
      return {
        messageId: msg ? String(msg.messageId) : String(Date.now()),
        fromUid,
        toUid: dto.toUid,
        content: dto.content,
        timestamp: msg
          ? new Date(msg.timestamp * 1000).toISOString()
          : new Date().toISOString(),
        read: false,
      };
    }

    // Create a new room — NodeBB also sends the initial message
    const result = await this.chatsProvider.createRoom([dto.toUid], dto.content);
    const room = result.data;
    return {
      messageId: room ? String(room.roomId) : String(Date.now()),
      fromUid,
      toUid: dto.toUid,
      content: dto.content,
      timestamp: new Date().toISOString(),
      read: false,
    };
  }

  /**
   * List chat rooms for a user, mapped to message DTOs.
   */
  async listMessages(uid: number, page = 1, perPage = 20): Promise<MessageListResponseDto> {
    const result = await this.chatsProvider.listRooms();
    const rooms = result.data ?? [];

    const messages: MessageResponseDto[] = rooms.map((room) => ({
      messageId: String(room.roomId),
      fromUid: room.lastMessage?.fromUid ?? room.owner,
      toUid: uid,
      content: room.lastMessage?.content ?? '',
      timestamp: room.lastMessage
        ? new Date(room.lastMessage.timestamp * 1000).toISOString()
        : new Date().toISOString(),
      read: (room.unread ?? 0) === 0,
    }));

    return {
      messages,
      totalCount: rooms.length,
      page,
      perPage,
    };
  }

  /**
   * Mark a chat room as read.
   * NodeBB marks read at the room level; messageId is treated as roomId.
   */
  async markRead(uid: number, messageId: number): Promise<void> {
    void uid;
    await this.chatsProvider.markRead(messageId);
  }
}
