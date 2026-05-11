import { Injectable } from '@nestjs/common';
import { NodebbTagsProvider } from '../nodebb/providers/nodebb-tags.provider';
import { BodyStatus } from '../nodebb/types';
import { TagItem, TagsResponse, TagTopicItem, TagTopicsResponse } from './tags.types';

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

  async listTopics(tag: string): Promise<TagTopicsResponse> {
    const response = await this.tagsProvider.listTopics(tag);

    if (response.status !== BodyStatus.OK || !response.data) {
      return { topics: [], source: 'fallback' };
    }

    const topics: TagTopicItem[] = response.data.topics.map((topic) => ({
      tid: topic.tid,
      uid: topic.uid,
      cid: topic.cid,
      title: topic.title,
      slug: topic.slug,
      mainPid: topic.mainPid,
      postcount: topic.postcount,
      viewcount: topic.viewcount,
      timestamp: topic.timestamp,
    }));

    return { topics, source: 'nodebb' };
  }
}
