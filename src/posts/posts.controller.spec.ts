import { Test, TestingModule } from '@nestjs/testing';
import { NotImplementedException } from '@nestjs/common';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';

const mockPostsService = {
  getPostDetail: jest.fn(),
  listReplies: jest.fn(),
};

describe('PostsController', () => {
  let controller: PostsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PostsController],
      providers: [{ provide: PostsService, useValue: mockPostsService }],
    }).compile();

    controller = module.get<PostsController>(PostsController);
    jest.clearAllMocks();
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
    it('should delegate to PostsService.getPostDetail', async () => {
      const mockDetail = { pid: 42, tid: 10, title: 'Test' };
      mockPostsService.getPostDetail.mockResolvedValue(mockDetail);

      const result = await controller.getPostDetail('42');

      expect(mockPostsService.getPostDetail).toHaveBeenCalledWith('42');
      expect(result).toBe(mockDetail);
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
    it('should delegate to PostsService.listReplies', async () => {
      const mockResult = { items: [], totalCount: 0, page: 1, perPage: 20 };
      mockPostsService.listReplies.mockResolvedValue(mockResult);

      const result = await controller.listReplies('42', { page: 1, perPage: 20 });

      expect(mockPostsService.listReplies).toHaveBeenCalledWith('42', { page: 1, perPage: 20 });
      expect(result).toBe(mockResult);
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
