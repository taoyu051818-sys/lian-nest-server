import { Inject, Injectable } from '@nestjs/common';
import { NodebbClient, NODEBB_CLIENT } from '../nodebb-client';
import { NodebbAuth, NodebbNormalizedResponse } from '../types';

/** Minimal shape for a chat room returned by NodeBB. */
export interface NodebbChatRoom {
  roomId: number;
  uids: number[];
  owner: number;
  lastMessage?: { content: string; timestamp: number; fromUid: number };
  unread?: number;
}

/** Minimal shape for a chat message returned by NodeBB. */
export interface NodebbChatMessage {
  messageId: number;
  roomId: number;
  fromUid: number;
  content: string;
  timestamp: number;
}

@Injectable()
export class NodebbChatsProvider {
  constructor(
    @Inject(NODEBB_CLIENT) private readonly client: NodebbClient,
  ) {}

  /** List all chat rooms the authenticated user participates in. */
  async listRooms(
    auth?: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<NodebbChatRoom[]>> {
    return this.client.get<NodebbChatRoom[]>('/api/v3/chats', auth);
  }

  /** Get messages in a chat room. */
  async getMessages(
    roomId: number,
    auth?: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<NodebbChatMessage[]>> {
    return this.client.get<NodebbChatMessage[]>(
      `/api/v3/chats/${roomId}`,
      auth,
    );
  }

  /** Send a message to an existing chat room. */
  async send(
    roomId: number,
    content: string,
    toUid: number,
    auth?: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<NodebbChatMessage>> {
    return this.client.post<NodebbChatMessage>(
      `/api/v3/chats/${roomId}`,
      { content, touid: toUid },
      auth,
    );
  }

  /** Create a new chat room with the given users and initial message. */
  async createRoom(
    uids: number[],
    content: string,
    auth?: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<NodebbChatRoom>> {
    return this.client.post<NodebbChatRoom>(
      '/api/v3/chats',
      { uids, content },
      auth,
    );
  }

  /** Mark all messages in a chat room as read. */
  async markRead(
    roomId: number,
    auth?: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<void>> {
    return this.client.put<void>(
      `/api/v3/chats/${roomId}/read`,
      {},
      auth,
    );
  }
}
