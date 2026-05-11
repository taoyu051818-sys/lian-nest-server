import { Test, TestingModule } from '@nestjs/testing';
import { NotImplementedException } from '@nestjs/common';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';

const mockPostsService = {
  getPostDetail: jest.fn(),
  listPosts: jest.fn(),
  listReactions: jest.fn(),
  listReplies: jest.fn(),
  createPost: jest.fn(),
  updatePost: jest.fn(),
  deletePost: jest.fn(),
  addReaction: jest.fn(),
  removeReaction: jest.fn(),
  createReply: jest.fn(),
  deleteReply: jest.fn(),
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
    it('should delegate to PostsService.listPosts', async () => {
      const mockResult = { items: [], totalCount: 0, page: 1, perPage: 20 };
      mockPostsService.listPosts.mockResolvedValue(mockResult);

      const result = await controller.listPosts({ page: 1, perPage: 20 });

      expect(mockPostsService.listPosts).toHaveBeenCalledWith({ page: 1, perPage: 20 });
      expect(result).toBe(mockResult);
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
    it('should delegate to PostsService.createPost', () => {
      mockPostsService.createPost.mockImplementation(() => {
        throw new NotImplementedException('PostsService.createPost');
      });

      expect(() => controller.createPost({ content: 'hello' })).toThrow(
        NotImplementedException,
      );
      expect(mockPostsService.createPost).toHaveBeenCalledWith({ content: 'hello' });
    });
  });

  describe('updatePost', () => {
    it('should delegate to PostsService.updatePost', () => {
      mockPostsService.updatePost.mockImplementation(() => {
        throw new NotImplementedException('PostsService.updatePost');
      });

      expect(() => controller.updatePost('1', { content: 'updated' })).toThrow(
        NotImplementedException,
      );
      expect(mockPostsService.updatePost).toHaveBeenCalledWith('1', { content: 'updated' });
    });
  });

  describe('deletePost', () => {
    it('should delegate to PostsService.deletePost', () => {
      mockPostsService.deletePost.mockImplementation(() => {
        throw new NotImplementedException('PostsService.deletePost');
      });

      expect(() => controller.deletePost('1')).toThrow(NotImplementedException);
      expect(mockPostsService.deletePost).toHaveBeenCalledWith('1');
    });
  });

  // ---- Reactions -----------------------------------------------------------

  describe('listReactions', () => {
    it('should delegate to PostsService.listReactions', async () => {
      const mockResult = [
        { type: 'like', count: 0, reactedByMe: false },
      ];
      mockPostsService.listReactions.mockResolvedValue(mockResult);

      const result = await controller.listReactions('42');

      expect(mockPostsService.listReactions).toHaveBeenCalledWith('42');
      expect(result).toBe(mockResult);
    });
  });

  describe('addReaction', () => {
    it('should delegate to PostsService.addReaction', () => {
      mockPostsService.addReaction.mockImplementation(() => {
        throw new NotImplementedException('PostsService.addReaction');
      });

      expect(() => controller.addReaction('1', { type: 'like' as any })).toThrow(
        NotImplementedException,
      );
      expect(mockPostsService.addReaction).toHaveBeenCalledWith('1', { type: 'like' });
    });
  });

  describe('removeReaction', () => {
    it('should delegate to PostsService.removeReaction', () => {
      mockPostsService.removeReaction.mockImplementation(() => {
        throw new NotImplementedException('PostsService.removeReaction');
      });

      expect(() => controller.removeReaction('1', 'like')).toThrow(
        NotImplementedException,
      );
      expect(mockPostsService.removeReaction).toHaveBeenCalledWith('1', 'like');
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
    it('should delegate to PostsService.createReply', () => {
      mockPostsService.createReply.mockImplementation(() => {
        throw new NotImplementedException('PostsService.createReply');
      });

      expect(() => controller.createReply('1', { content: 'reply' })).toThrow(
        NotImplementedException,
      );
      expect(mockPostsService.createReply).toHaveBeenCalledWith('1', { content: 'reply' });
    });
  });

  describe('deleteReply', () => {
    it('should delegate to PostsService.deleteReply', () => {
      mockPostsService.deleteReply.mockImplementation(() => {
        throw new NotImplementedException('PostsService.deleteReply');
      });

      expect(() => controller.deleteReply('1', 'r1')).toThrow(NotImplementedException);
      expect(mockPostsService.deleteReply).toHaveBeenCalledWith('1', 'r1');
    });
  });
});
