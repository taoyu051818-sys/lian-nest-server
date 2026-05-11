import { Inject, Injectable } from '@nestjs/common';
import { NodebbClient, NODEBB_CLIENT } from '../nodebb-client';
import { NodebbAuth, NodebbNormalizedResponse } from '../types';

export interface NodebbGroup {
  name: string;
  slug: string;
  description: string;
  memberCount: number;
  hidden: number;
  deleted: number;
  system: number;
  createtime: number;
  cover?: { thumb?: string; url?: string };
}

@Injectable()
export class NodebbGroupsProvider {
  constructor(
    @Inject(NODEBB_CLIENT) private readonly client: NodebbClient,
  ) {}

  async list(
    auth?: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<NodebbGroup[]>> {
    return this.client.get<NodebbGroup[]>('/api/v3/groups', auth);
  }
}
