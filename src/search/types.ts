/** Search result item returned by GET /api/search */
export interface SearchResultItem {
  id: number;
  title: string;
  snippet: string;
  timestamp: number;
}

/** Response envelope for GET /api/search */
export interface SearchResponse {
  term: string;
  items: SearchResultItem[];
  total: number;
  page: number;
  pages: number;
  source: 'nodebb' | 'fallback';
}
