import { Inject, Injectable } from '@nestjs/common';
import { NodebbClient, NODEBB_CLIENT } from '../nodebb-client';
import { NodebbAuth, NodebbNormalizedResponse, NodebbCategory } from '../types';

@Injectable()
export class NodebbCategoriesProvider {
  constructor(
    @Inject(NODEBB_CLIENT) private readonly client: NodebbClient,
  ) {}

  async list(
    auth?: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<NodebbCategory[]>> {
    return this.client.get<NodebbCategory[]>('/api/v3/categories', auth);
  }

  async getById(
    cid: number,
    auth?: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<NodebbCategory>> {
    return this.client.get<NodebbCategory>(`/api/v3/categories/${cid}`, auth);
  }
}
