import { Injectable, NotFoundException } from '@nestjs/common';
import { FeedItemDto } from '../dto';
import { NodebbTopicsProvider } from '../../nodebb/providers/nodebb-topics.provider';
import { NodebbPostsProvider } from '../../nodebb/providers/nodebb-posts.provider';
import { NodebbUsersProvider } from '../../nodebb/providers/nodebb-users.provider';
import { BodyStatus } from '../../nodebb/types';

export interface GetFeedItemInput {
  feedItemId: string;
  userId: number;
}

@Injectable()
export class GetFeedItemUsecase {
  constructor(
    private readonly topicsProvider: NodebbTopicsProvider,
    private readonly postsProvider: NodebbPostsProvider,
    private readonly usersProvider: NodebbUsersProvider,
  ) {}

  async execute(input: GetFeedItemInput): Promise<FeedItemDto> {
    const tid = this.parseFeedItemId(input.feedItemId);

    const topicRes = await this.topicsProvider.getById(tid);
    if (topicRes.status !== BodyStatus.OK || !topicRes.data) {
      throw new NotFoundException(`Feed item ${input.feedItemId} not found`);
    }

    const topic = topicRes.data;

    const [postRes, userRes] = await Promise.all([
      this.postsProvider.getByPid(topic.mainPid),
      this.usersProvider.getByUid(topic.uid),
    ]);

    return {
      id: `t${topic.tid}`,
      postId: topic.mainPid,
      topicId: topic.tid,
      title: topic.title,
      snippet: postRes.data?.content?.substring(0, 200) ?? '',
      authorUid: topic.uid,
      authorUsername: userRes.data?.username ?? 'unknown',
      createdAt: new Date(topic.timestamp * 1000).toISOString(),
    };
  }

  private parseFeedItemId(feedItemId: string): number {
    const match = feedItemId.match(/^t(\d+)$/);
    if (!match) {
      throw new NotFoundException(`Invalid feed item ID: ${feedItemId}`);
    }
    return Number(match[1]);
  }
}
