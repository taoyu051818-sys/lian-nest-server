/**
 * PostsModule — DTOs and domain types.
 *
 * PostDetail is the first runtime endpoint (issue #121).
 * Other handlers remain stubs throwing NotImplementedException.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum PostReactionType {
  LIKE = 'like',
  LOVE = 'love',
  HAHA = 'haha',
  WOW = 'wow',
  SAD = 'sad',
  ANGRY = 'angry',
}

// ---------------------------------------------------------------------------
// Domain DTOs
// ---------------------------------------------------------------------------

export interface PostAuthor {
  uid: number;
  username: string;
  avatar: string | null;
  reputation: number;
}

export interface TopicSummary {
  tid: number;
  title: string;
  slug: string;
  cid: number;
  categoryName: string;
  tagWhitelist: string[];
  postCount: number;
  viewCount: number;
  timestamp: number;
  lastPostTime: number;
  isPinned: boolean;
  isLocked: boolean;
  isDeleted: boolean;
}

export interface PostReactionSummary {
  type: PostReactionType;
  count: number;
  reactedByMe: boolean;
}

export interface PostReply {
  id: string;
  postId: string;
  author: PostAuthor;
  content: string;
  createdAt: string;
  updatedAt?: string;
}

export interface PostDetail {
  pid: number;
  tid: number;
  title: string;
  slug: string;
  content: string;
  contentHtml: string;
  author: PostAuthor;
  timestamp: number;
  editedTimestamp: number | null;
  editedByUid: number | null;
  voteCount: number;
  bookmarkCount: number;
  replyCount: number;
  viewCount: number;
  tags: string[];
  isPinned: boolean;
  isLocked: boolean;
  isDeleted: boolean;
  topic: TopicSummary;
}

export interface PostListItem {
  id: string;
  author: PostAuthor;
  content: string;
  createdAt: string;
  replyCount: number;
}

export interface PostPaginatedList {
  items: PostListItem[];
  totalCount: number;
  page: number;
  perPage: number;
}

// ---------------------------------------------------------------------------
// Request DTOs
// ---------------------------------------------------------------------------

export interface CreatePostBody {
  content: string;
}

export interface UpdatePostBody {
  content: string;
}

export interface CreateReactionBody {
  type: PostReactionType;
}

export interface CreateReplyBody {
  content: string;
}

export interface ListPostsQuery {
  page?: number;
  perPage?: number;
}

export interface ListRepliesQuery {
  page?: number;
  perPage?: number;
}
