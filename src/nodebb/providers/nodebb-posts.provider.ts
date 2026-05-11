import { Inject, Injectable } from '@nestjs/common';
import { NodebbClient, NODEBB_CLIENT } from '../nodebb-client';
import { NodebbAuth, NodebbNormalizedResponse, NodebbPost } from '../types';

@Injectable()
export class NodebbPostsProvider {
  constructor(
    @Inject(NODEBB_CLIENT) private readonly client: NodebbClient,
  ) {}

  async getByPid(
    pid: number,
    auth?: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<NodebbPost>> {
    return this.client.get<NodebbPost>(`/api/v3/posts/${pid}`, auth);
  }

  async create(
    data: { tid: number; content: string },
    auth: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<{ pid: number }>> {
    return this.client.post<{ pid: number }>('/api/v3/posts', data, auth);
  }

  async update(
    pid: number,
    data: { content: string },
    auth: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<void>> {
    return this.client.put<void>(`/api/v3/posts/${pid}`, data, auth);
  }

  async delete(
    pid: number,
    auth: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<void>> {
    return this.client.delete<void>(`/api/v3/posts/${pid}`, auth);
  }
}
