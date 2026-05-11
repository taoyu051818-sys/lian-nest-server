import { Injectable } from '@nestjs/common';
import { FeedQueryDto, FeedResponseDto, FeedItemDto } from '../dto';
import { NodebbTopicsProvider } from '../../nodebb/providers/nodebb-topics.provider';
import { NodebbPostsProvider } from '../../nodebb/providers/nodebb-posts.provider';
import { NodebbUsersProvider } from '../../nodebb/providers/nodebb-users.provider';
import { BodyStatus } from '../../nodebb/types';

export interface GetFeedInput extends FeedQueryDto {
  userId: number;
}

@Injectable()
export class GetFeedUsecase {
  constructor(
    private readonly topicsProvider: NodebbTopicsProvider,
    private readonly postsProvider: NodebbPostsProvider,
    private readonly usersProvider: NodebbUsersProvider,
  ) {}

  async execute(input: GetFeedInput): Promise<FeedResponseDto> {
    const page = input.page ?? 1;
    const perPage = input.perPage ?? 20;

    const topicsRes = await this.topicsProvider.list({ page });

    if (topicsRes.status !== BodyStatus.OK || !topicsRes.data) {
      return { items: [], totalCount: 0, page, perPage };
    }

    const topics = topicsRes.data.topics;
    if (topics.length === 0) {
      return { items: [], totalCount: 0, page, perPage };
    }

    const items: FeedItemDto[] = await Promise.all(
      topics.map((topic) => this.mapTopicToFeedItem(topic)),
    );

    return {
      items,
      totalCount: items.length,
      page,
      perPage,
    };
  }

  private async mapTopicToFeedItem(topic: {
    tid: number;
    uid: number;
    title: string;
    mainPid: number;
    timestamp: number;
  }): Promise<FeedItemDto> {
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
}
