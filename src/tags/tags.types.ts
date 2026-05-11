/** A single tag returned by GET /api/tags */
export interface TagItem {
  value: string;
  score: number;
  color: string | null;
}

/** Response shape for GET /api/tags */
export interface TagsResponse {
  tags: TagItem[];
  source: 'nodebb' | 'fallback';
}

/** A single topic returned by GET /api/tags/:tag/topics */
export interface TagTopicItem {
  tid: number;
  uid: number;
  cid: number;
  title: string;
  slug: string;
  mainPid: number;
  postcount: number;
  viewcount: number;
  timestamp: number;
}

/** Query params for GET /api/tags/:tag/topics */
export interface TagTopicsQuery {
  page?: number;
  perPage?: number;
}

/** Response shape for GET /api/tags/:tag/topics */
export interface TagTopicsResponse {
  topics: TagTopicItem[];
  source: 'nodebb' | 'fallback';
  totalCount: number;
  page: number;
  perPage: number;
}
