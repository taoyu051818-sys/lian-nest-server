import { Injectable, NotFoundException } from '@nestjs/common';
import { NodebbTopicsProvider } from '../nodebb/providers/nodebb-topics.provider';
import { BodyStatus } from '../nodebb/types';
import { TopicDetail } from './types';

@Injectable()
export class TopicsUsecase {
  constructor(private readonly topicsProvider: NodebbTopicsProvider) {}

  async getByTid(tidParam: string): Promise<TopicDetail> {
    const tid = Number(tidParam);
    if (!Number.isInteger(tid) || tid <= 0) {
      throw new NotFoundException(`Invalid tid: ${tidParam}`);
    }

    const response = await this.topicsProvider.getById(tid);

    if (response.status === BodyStatus.NOT_FOUND || !response.data) {
      throw new NotFoundException(`Topic ${tid} not found`);
    }

    const topic = response.data;
    return {
      tid: topic.tid,
      uid: topic.uid,
      cid: topic.cid,
      title: topic.title,
      slug: topic.slug,
      mainPid: topic.mainPid,
      postcount: topic.postcount,
      viewcount: topic.viewcount,
      timestamp: topic.timestamp,
      source: 'nodebb',
    };
  }
}
