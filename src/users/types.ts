/** User detail shape returned by GET /api/users/:uid */
export interface UserDetail {
  uid: string;
  username: string;
  userslug: string;
  joinedAt: string;
  reputation: number;
  postCount: number;
}
