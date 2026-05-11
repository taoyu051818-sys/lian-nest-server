import { Injectable, BadRequestException } from '@nestjs/common';
import { NodebbSearchProvider } from '../nodebb/providers/nodebb-search.provider';
import { BodyStatus } from '../nodebb/types';
import { SearchResponse } from './types';

@Injectable()
export class SearchUsecase {
  constructor(private readonly searchProvider: NodebbSearchProvider) {}

  async search(term: string, pageParam?: string): Promise<SearchResponse> {
    if (!term || term.trim().length === 0) {
      throw new BadRequestException('Search term is required');
    }

    const page = pageParam != null ? Number(pageParam) : 1;
    if (pageParam != null && (!Number.isInteger(page) || page <= 0)) {
      throw new BadRequestException(`Invalid page: ${pageParam}`);
    }

    const response = await this.searchProvider.search(term.trim(), { page });

    if (response.status === BodyStatus.ERROR || response.status === BodyStatus.NOT_FOUND || !response.data) {
      throw new BadRequestException(response.error || 'Search provider error');
    }

    const data = response.data;
    return {
      term: term.trim(),
      items: (data.matches ?? []).map((m) => ({
        id: m.id,
        title: m.title,
        snippet: m.content,
        timestamp: m.timestamp,
      })),
      total: data.matchCount ?? 0,
      page: data.pagination?.page ?? page,
      pages: data.pagination?.pageCount ?? 1,
      source: 'nodebb',
    };
  }
}
