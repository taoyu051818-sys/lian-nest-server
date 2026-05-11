import { Injectable } from '@nestjs/common';
import { NodebbTagsProvider } from '../nodebb/providers/nodebb-tags.provider';
import { BodyStatus } from '../nodebb/types';
import { TagItem, TagsResponse } from './tags.types';

@Injectable()
export class TagsUsecase {
  constructor(private readonly tagsProvider: NodebbTagsProvider) {}

  async list(): Promise<TagsResponse> {
    const response = await this.tagsProvider.list();

    if (response.status !== BodyStatus.OK || !response.data) {
      return { tags: [], source: 'fallback' };
    }

    const tags: TagItem[] = response.data.map((tag) => ({
      value: tag.value,
      score: tag.score,
      color: tag.color ?? null,
    }));

    return { tags, source: 'nodebb' };
  }
}
