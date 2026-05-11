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
