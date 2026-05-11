import { Inject, Injectable } from '@nestjs/common';
import { NodebbClient, NODEBB_CLIENT } from '../nodebb-client';
import {
  NodebbAuth,
  NodebbNormalizedResponse,
  NodebbNotification,
} from '../types';

@Injectable()
export class NodebbNotificationsProvider {
  constructor(
    @Inject(NODEBB_CLIENT) private readonly client: NodebbClient,
  ) {}

  async list(
    auth: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<NodebbNotification[]>> {
    return this.client.get<NodebbNotification[]>(
      '/api/v3/notifications',
      auth,
    );
  }

  async markRead(
    nid: string,
    auth: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<void>> {
    return this.client.put<void>(
      `/api/v3/notifications/${nid}`,
      {},
      auth,
    );
  }
}
