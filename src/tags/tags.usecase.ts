import { Injectable } from '@nestjs/common';
import { NodebbTagsProvider } from '../nodebb/providers/nodebb-tags.provider';
import { BodyStatus } from '../nodebb/types';
import { TagItem, TagsResponse, TagTopicItem, TagTopicsQuery, TagTopicsResponse } from './tags.types';

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

  async listTopics(tag: string, query: TagTopicsQuery = {}): Promise<TagTopicsResponse> {
    const page = Math.max(1, Math.floor(Number(query.page) || 1));
    const perPage = Math.max(1, Math.min(100, Math.floor(Number(query.perPage) || 20)));

    const response = await this.tagsProvider.listTopics(tag);

    if (response.status !== BodyStatus.OK || !response.data) {
      return { topics: [], source: 'fallback', totalCount: 0, page, perPage };
    }

    const allTopics: TagTopicItem[] = response.data.topics.map((topic) => ({
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

    const totalCount = allTopics.length;
    const start = (page - 1) * perPage;
    const topics = allTopics.slice(start, start + perPage);

    return { topics, source: 'nodebb', totalCount, page, perPage };
  }
}
