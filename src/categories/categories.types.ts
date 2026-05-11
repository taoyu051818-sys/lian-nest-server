/** A single category returned by GET /api/categories */
export interface CategoryItem {
  cid: number;
  name: string;
  slug: string;
  description: string;
  icon: string;
  color: string;
  bgColor: string;
  topicCount: number;
  postCount: number;
}

/** Response shape for GET /api/categories */
export interface CategoriesResponse {
  categories: CategoryItem[];
  source: 'nodebb' | 'fallback';
}
