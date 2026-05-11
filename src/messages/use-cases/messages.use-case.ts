import { Injectable } from '@nestjs/common';
import { CreateMessageDto, MessageResponseDto, MessageListResponseDto } from '../dto/message.dto';

@Injectable()
export class MessagesUseCase {
  /**
   * Send a message from one user to another.
   * TODO: Wire to NodeBB chat/message API when available.
   */
  async sendMessage(fromUid: number, dto: CreateMessageDto): Promise<MessageResponseDto> {
    void fromUid;
    void dto;
    throw new Error('Not implemented: MessagesUseCase.sendMessage — awaiting NodeBB message provider');
  }

  /**
   * List messages for a user (inbox or thread).
   * TODO: Wire to NodeBB chat/message API when available.
   */
  async listMessages(uid: number, page = 1, perPage = 20): Promise<MessageListResponseDto> {
    void uid;
    void page;
    void perPage;
    throw new Error('Not implemented: MessagesUseCase.listMessages — awaiting NodeBB message provider');
  }

  /**
   * Mark a message as read.
   * TODO: Wire to NodeBB chat/message API when available.
   */
  async markRead(uid: number, messageId: number): Promise<void> {
    void uid;
    void messageId;
    throw new Error('Not implemented: MessagesUseCase.markRead — awaiting NodeBB message provider');
  }
}
