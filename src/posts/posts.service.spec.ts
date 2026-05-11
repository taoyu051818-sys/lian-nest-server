import { Test, TestingModule } from '@nestjs/testing';
import { NotImplementedException } from '@nestjs/common';
import { PostsService } from './posts.service';

describe('PostsService', () => {
  let service: PostsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PostsService],
    }).compile();

    service = module.get<PostsService>(PostsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---- Read ----------------------------------------------------------------

  describe('listPosts', () => {
    it('should throw NotImplementedException', () => {
      expect(() => service.listPosts({})).toThrow(NotImplementedException);
    });
  });

  describe('getPostDetail', () => {
    it('should throw NotImplementedException', () => {
      expect(() => service.getPostDetail('1')).toThrow(NotImplementedException);
    });
  });

  // ---- Write ---------------------------------------------------------------

  describe('createPost', () => {
    it('should throw NotImplementedException', () => {
      expect(() => service.createPost({ content: 'hello' })).toThrow(
        NotImplementedException,
      );
    });
  });

  describe('updatePost', () => {
    it('should throw NotImplementedException', () => {
      expect(() => service.updatePost('1', { content: 'updated' })).toThrow(
        NotImplementedException,
      );
    });
  });

  describe('deletePost', () => {
    it('should throw NotImplementedException', () => {
      expect(() => service.deletePost('1')).toThrow(NotImplementedException);
    });
  });

  // ---- Reactions -----------------------------------------------------------

  describe('listReactions', () => {
    it('should throw NotImplementedException', () => {
      expect(() => service.listReactions('1')).toThrow(NotImplementedException);
    });
  });

  describe('addReaction', () => {
    it('should throw NotImplementedException', () => {
      expect(() =>
        service.addReaction('1', { type: 'like' as any }),
      ).toThrow(NotImplementedException);
    });
  });

  describe('removeReaction', () => {
    it('should throw NotImplementedException', () => {
      expect(() => service.removeReaction('1', 'like')).toThrow(
        NotImplementedException,
      );
    });
  });

  // ---- Replies -------------------------------------------------------------

  describe('listReplies', () => {
    it('should throw NotImplementedException', () => {
      expect(() => service.listReplies('1', {})).toThrow(
        NotImplementedException,
      );
    });
  });

  describe('createReply', () => {
    it('should throw NotImplementedException', () => {
      expect(() => service.createReply('1', { content: 'reply' })).toThrow(
        NotImplementedException,
      );
    });
  });

  describe('deleteReply', () => {
    it('should throw NotImplementedException', () => {
      expect(() => service.deleteReply('1', 'r1')).toThrow(
        NotImplementedException,
      );
    });
  });
});
