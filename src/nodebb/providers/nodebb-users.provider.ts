import { Inject, Injectable } from '@nestjs/common';
import { NodebbClient, NODEBB_CLIENT } from '../nodebb-client';
import { NodebbAuth, NodebbNormalizedResponse, NodebbUser } from '../types';

@Injectable()
export class NodebbUsersProvider {
  constructor(
    @Inject(NODEBB_CLIENT) private readonly client: NodebbClient,
  ) {}

  async getByUid(
    uid: number,
    auth?: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<NodebbUser>> {
    return this.client.get<NodebbUser>(`/api/v3/users/${uid}`, auth);
  }

  async getBySlug(
    slug: string,
    auth?: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<NodebbUser>> {
    return this.client.get<NodebbUser>(`/api/v3/user/bySlug/${slug}`, auth);
  }
}
