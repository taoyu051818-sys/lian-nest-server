import { Inject, Injectable } from '@nestjs/common';
import { NodebbClient, NODEBB_CLIENT } from '../nodebb-client';
import { NodebbAuth, NodebbNormalizedResponse, NodebbTopic } from '../types';

export interface NodebbTopicsListResponse {
  topics: NodebbTopic[];
}

@Injectable()
export class NodebbTopicsProvider {
  constructor(
    @Inject(NODEBB_CLIENT) private readonly client: NodebbClient,
  ) {}

  async getById(
    tid: number,
    auth?: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<NodebbTopic>> {
    return this.client.get<NodebbTopic>(`/api/v3/topics/${tid}`, auth);
  }

  async list(
    options?: { page?: number },
    auth?: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<NodebbTopicsListResponse>> {
    const params = new URLSearchParams();
    if (options?.page != null) params.set('page', String(options.page));
    const qs = params.toString();
    const path = qs ? `/api/v3/topics?${qs}` : '/api/v3/topics';
    return this.client.get<NodebbTopicsListResponse>(path, auth);
  }

  async create(
    data: { cid: number; title: string; content: string },
    auth: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<{ tid: number }>> {
    return this.client.post<{ tid: number }>('/api/v3/topics', data, auth);
  }

  async update(
    tid: number,
    data: { title?: string; tags?: string[] },
    auth: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<void>> {
    return this.client.put<void>(`/api/v3/topics/${tid}`, data, auth);
  }

  async delete(
    tid: number,
    auth: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<void>> {
    return this.client.delete<void>(`/api/v3/topics/${tid}`, auth);
  }
}
