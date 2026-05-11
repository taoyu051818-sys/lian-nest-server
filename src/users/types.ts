/** User detail shape returned by GET /api/users/:uid */
export interface UserDetail {
  uid: string;
  username: string;
  userslug: string;
  joinedAt: string;
  reputation: number;
  postCount: number;
}

/** Single post item returned by GET /api/users/:uid/posts */
export interface UserPostItem {
  pid: number;
  tid: number;
  uid: number;
  content: string;
  timestamp: string;
}

/** Response shape for GET /api/users/:uid/posts */
export interface UserPostsResponse {
  posts: UserPostItem[];
  source: 'nodebb' | 'fallback';
}
