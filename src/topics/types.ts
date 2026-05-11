/** Topic detail shape returned by GET /api/topic/:tid */
export interface TopicDetail {
  tid: number;
  uid: number;
  cid: number;
  title: string;
  slug: string;
  mainPid: number;
  postcount: number;
  viewcount: number;
  timestamp: number;
  source: 'nodebb' | 'fallback';
}
