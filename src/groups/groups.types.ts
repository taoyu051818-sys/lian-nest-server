/** A single group returned by GET /api/groups */
export interface GroupItem {
  name: string;
  slug: string;
  description: string;
  memberCount: number;
  hidden: boolean;
  deleted: boolean;
  createtime: number;
}

/** Response shape for GET /api/groups */
export interface GroupsResponse {
  groups: GroupItem[];
  source: 'nodebb' | 'fallback';
}
