/**
 * PostsModule — DTOs and domain types.
 *
 * Skeleton stubs for detail / read / write / reactions / replies.
 * No runtime behavior; every handler throws NotImplementedException.
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
  id: string;
  username: string;
  avatarUrl?: string;
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
  id: string;
  author: PostAuthor;
  content: string;
  createdAt: string;
  updatedAt?: string;
  reactionCounts: PostReactionSummary[];
  replyCount: number;
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
