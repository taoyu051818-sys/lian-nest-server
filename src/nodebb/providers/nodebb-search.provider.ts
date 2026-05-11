import { Inject, Injectable } from '@nestjs/common';
import { NodebbClient, NODEBB_CLIENT } from '../nodebb-client';
import { NodebbAuth, NodebbNormalizedResponse } from '../types';

export interface NodebbSearchResult {
  id: number;
  title: string;
  content: string;
  timestamp: number;
}

export interface NodebbSearchResponse {
  matches: NodebbSearchResult[];
  matchCount: number;
  pagination: {
    page: number;
    pageCount: number;
    itemsPerPage: number;
  };
}

@Injectable()
export class NodebbSearchProvider {
  constructor(
    @Inject(NODEBB_CLIENT) private readonly client: NodebbClient,
  ) {}

  async search(
    term: string,
    options?: { page?: number },
    auth?: NodebbAuth,
  ): Promise<NodebbNormalizedResponse<NodebbSearchResponse>> {
    const params = new URLSearchParams();
    params.set('term', term);
    if (options?.page != null) params.set('page', String(options.page));
    return this.client.get<NodebbSearchResponse>(
      `/api/v3/search?${params.toString()}`,
      auth,
    );
  }
}
