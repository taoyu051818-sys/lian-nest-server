/**
 * Post metadata repository interface.
 *
 * Stores post metadata for quick lookups without
 * requiring full NodeBB API calls.
 */

export interface PostMetadata {
  id: string;
  nodebbPid: number;
  nodebbTid: number;
  authorId: string;
  contentPreview: string | null;
  tags: string[];
  replyCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IPostMetadataRepository {
  findById(id: string): Promise<PostMetadata | null>;
  findByNodebbPid(nodebbPid: number): Promise<PostMetadata | null>;
  findByAuthorId(authorId: string, limit?: number): Promise<PostMetadata[]>;
  findByTags(tags: string[], limit?: number): Promise<PostMetadata[]>;
  upsert(metadata: Omit<PostMetadata, 'id' | 'createdAt' | 'updatedAt'>): Promise<PostMetadata>;
  deleteByNodebbPid(nodebbPid: number): Promise<void>;
}
