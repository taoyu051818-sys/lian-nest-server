import { Inject, Injectable } from '@nestjs/common';
import { NodebbClient, NODEBB_CLIENT } from '../nodebb-client';
import { NodebbAuth, NodebbNormalizedResponse, NodebbTag } from '../types';

@Injectable()
export class NodebbTagsProvider {
  constructor(
    @Inject(NODEBB_CLIENT) private readonly client: NodebbClient,
  ) {}

  async list(
    auth?: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<NodebbTag[]>> {
    return this.client.get<NodebbTag[]>('/api/v3/tags', auth);
  }
}
