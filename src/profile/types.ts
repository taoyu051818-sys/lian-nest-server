/** Public profile shape returned by GET /api/profile/:uid */
export interface PublicProfile {
  uid: string;
  username: string;
  displayName: string;
  avatar: string | null;
  bio: string | null;
  postCount: number;
  reputation: number;
  joinedAt: string;
}

/** A single item in the saved collection */
export interface SavedItem {
  id: string;
  type: 'topic' | 'post';
  targetId: string;
  savedAt: string;
}

/** A single item in the liked collection */
export interface LikedItem {
  id: string;
  type: 'topic' | 'post';
  targetId: string;
  likedAt: string;
}

/** A single item in the history collection */
export interface HistoryItem {
  id: string;
  type: 'topic' | 'post';
  targetId: string;
  viewedAt: string;
}

/** Generic paginated wrapper for collection endpoints */
export interface ProfileCollection<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  source: 'nodebb' | 'fallback';
}

/** Query parameters for collection pagination */
export interface CollectionQuery {
  page?: number;
  pageSize?: number;
}
