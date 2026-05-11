import { Injectable } from '@nestjs/common';
import { IPostMetadataRepository, PostMetadata } from '../interfaces';

/**
 * Skeleton post metadata repository.
 *
 * TODO: Replace with Prisma implementation (issue #9).
 * Storage boundary: Postgres (primary).
 */
@Injectable()
export class PostMetadataRepository implements IPostMetadataRepository {
  async findById(_id: string): Promise<PostMetadata | null> {
    throw new Error('PostMetadataRepository.findById not implemented');
  }

  async findByNodebbPid(_nodebbPid: number): Promise<PostMetadata | null> {
    throw new Error('PostMetadataRepository.findByNodebbPid not implemented');
  }

  async findByAuthorId(
    _authorId: string,
    _limit?: number,
  ): Promise<PostMetadata[]> {
    throw new Error('PostMetadataRepository.findByAuthorId not implemented');
  }

  async findByTags(
    _tags: string[],
    _limit?: number,
  ): Promise<PostMetadata[]> {
    throw new Error('PostMetadataRepository.findByTags not implemented');
  }

  async upsert(
    _metadata: Omit<PostMetadata, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<PostMetadata> {
    throw new Error('PostMetadataRepository.upsert not implemented');
  }

  async deleteByNodebbPid(_nodebbPid: number): Promise<void> {
    throw new Error('PostMetadataRepository.deleteByNodebbPid not implemented');
  }
}
