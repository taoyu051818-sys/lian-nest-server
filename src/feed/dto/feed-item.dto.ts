export class FeedItemDto {
  id: string;
  postId: number;
  topicId: number;
  title: string;
  snippet: string;
  authorUid: number;
  authorUsername: string;
  createdAt: string;
}

export class FeedResponseDto {
  items: FeedItemDto[];
  totalCount: number;
  page: number;
  perPage: number;
}
