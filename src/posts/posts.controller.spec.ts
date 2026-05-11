import { Test, TestingModule } from '@nestjs/testing';
import { NotImplementedException } from '@nestjs/common';
import { PostsController } from './posts.controller';

describe('PostsController', () => {
  let controller: PostsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PostsController],
    }).compile();

    controller = module.get<PostsController>(PostsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ---- Read ----------------------------------------------------------------

  describe('listPosts', () => {
    it('should throw NotImplementedException', () => {
      expect(() => controller.listPosts({})).toThrow(NotImplementedException);
    });
  });

  describe('getPostDetail', () => {
    it('should throw NotImplementedException', () => {
      expect(() => controller.getPostDetail('1')).toThrow(
        NotImplementedException,
      );
    });
  });

  // ---- Write ---------------------------------------------------------------

  describe('createPost', () => {
    it('should throw NotImplementedException', () => {
      expect(() => controller.createPost({ content: 'hello' })).toThrow(
        NotImplementedException,
      );
    });
  });

  describe('updatePost', () => {
    it('should throw NotImplementedException', () => {
      expect(() =>
        controller.updatePost('1', { content: 'updated' }),
      ).toThrow(NotImplementedException);
    });
  });

  describe('deletePost', () => {
    it('should throw NotImplementedException', () => {
      expect(() => controller.deletePost('1')).toThrow(NotImplementedException);
    });
  });

  // ---- Reactions -----------------------------------------------------------

  describe('listReactions', () => {
    it('should throw NotImplementedException', () => {
      expect(() => controller.listReactions('1')).toThrow(
        NotImplementedException,
      );
    });
  });

  describe('addReaction', () => {
    it('should throw NotImplementedException', () => {
      expect(() =>
        controller.addReaction('1', { type: 'like' as any }),
      ).toThrow(NotImplementedException);
    });
  });

  describe('removeReaction', () => {
    it('should throw NotImplementedException', () => {
      expect(() => controller.removeReaction('1', 'like')).toThrow(
        NotImplementedException,
      );
    });
  });

  // ---- Replies -------------------------------------------------------------

  describe('listReplies', () => {
    it('should throw NotImplementedException', () => {
      expect(() => controller.listReplies('1', {})).toThrow(
        NotImplementedException,
      );
    });
  });

  describe('createReply', () => {
    it('should throw NotImplementedException', () => {
      expect(() =>
        controller.createReply('1', { content: 'reply' }),
      ).toThrow(NotImplementedException);
    });
  });

  describe('deleteReply', () => {
    it('should throw NotImplementedException', () => {
      expect(() => controller.deleteReply('1', 'r1')).toThrow(
        NotImplementedException,
      );
    });
  });
});
