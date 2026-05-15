import { Test, TestingModule } from '@nestjs/testing';
import { NotImplementedException } from '@nestjs/common';
import { PostsController } from './posts.controller';
import { PostsUsecase } from './posts.service';

const mockPostsUsecase = {
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
      providers: [{ provide: PostsUsecase, useValue: mockPostsUsecase }],
    }).compile();

    controller = module.get<PostsController>(PostsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ---- Read ----------------------------------------------------------------

  describe('listPosts', () => {
    it('should delegate to PostsUsecase.listPosts', async () => {
      const mockResult = { items: [], totalCount: 0, page: 1, perPage: 20 };
      mockPostsUsecase.listPosts.mockResolvedValue(mockResult);

      const result = await controller.listPosts({ page: 1, perPage: 20 });

      expect(mockPostsUsecase.listPosts).toHaveBeenCalledWith({ page: 1, perPage: 20 });
      expect(result).toBe(mockResult);
    });
  });

  describe('getPostDetail', () => {
    it('should delegate to PostsUsecase.getPostDetail', async () => {
      const mockDetail = { pid: 42, tid: 10, title: 'Test' };
      mockPostsUsecase.getPostDetail.mockResolvedValue(mockDetail);

      const result = await controller.getPostDetail('42');

      expect(mockPostsUsecase.getPostDetail).toHaveBeenCalledWith('42');
      expect(result).toBe(mockDetail);
    });
  });

  // ---- Write ---------------------------------------------------------------

  describe('createPost', () => {
    it('should delegate to PostsUsecase.createPost', () => {
      mockPostsUsecase.createPost.mockImplementation(() => {
        throw new NotImplementedException('PostsUsecase.createPost');
      });

      expect(() => controller.createPost({ content: 'hello' }, 1)).toThrow(
        NotImplementedException,
      );
      expect(mockPostsUsecase.createPost).toHaveBeenCalledWith({ content: 'hello' });
    });
  });

  describe('updatePost', () => {
    it('should delegate to PostsUsecase.updatePost', () => {
      mockPostsUsecase.updatePost.mockImplementation(() => {
        throw new NotImplementedException('PostsUsecase.updatePost');
      });

      expect(() => controller.updatePost('1', { content: 'updated' }, 1)).toThrow(
        NotImplementedException,
      );
      expect(mockPostsUsecase.updatePost).toHaveBeenCalledWith('1', { content: 'updated' });
    });
  });

  describe('deletePost', () => {
    it('should delegate to PostsUsecase.deletePost', () => {
      mockPostsUsecase.deletePost.mockImplementation(() => {
        throw new NotImplementedException('PostsUsecase.deletePost');
      });

      expect(() => controller.deletePost('1', 1)).toThrow(NotImplementedException);
      expect(mockPostsUsecase.deletePost).toHaveBeenCalledWith('1');
    });
  });

  // ---- Reactions -----------------------------------------------------------

  describe('listReactions', () => {
    it('should delegate to PostsUsecase.listReactions', async () => {
      const mockResult = [
        { type: 'like', count: 0, reactedByMe: false },
      ];
      mockPostsUsecase.listReactions.mockResolvedValue(mockResult);

      const result = await controller.listReactions('42');

      expect(mockPostsUsecase.listReactions).toHaveBeenCalledWith('42');
      expect(result).toBe(mockResult);
    });
  });

  describe('addReaction', () => {
    it('should delegate to PostsUsecase.addReaction', () => {
      mockPostsUsecase.addReaction.mockImplementation(() => {
        throw new NotImplementedException('PostsUsecase.addReaction');
      });

      expect(() => controller.addReaction('1', { type: 'like' as any }, 1)).toThrow(
        NotImplementedException,
      );
      expect(mockPostsUsecase.addReaction).toHaveBeenCalledWith('1', { type: 'like' });
    });
  });

  describe('removeReaction', () => {
    it('should delegate to PostsUsecase.removeReaction', () => {
      mockPostsUsecase.removeReaction.mockImplementation(() => {
        throw new NotImplementedException('PostsUsecase.removeReaction');
      });

      expect(() => controller.removeReaction('1', 'like', 1)).toThrow(
        NotImplementedException,
      );
      expect(mockPostsUsecase.removeReaction).toHaveBeenCalledWith('1', 'like');
    });
  });

  // ---- Replies -------------------------------------------------------------

  describe('listReplies', () => {
    it('should delegate to PostsUsecase.listReplies', async () => {
      const mockResult = { items: [], totalCount: 0, page: 1, perPage: 20 };
      mockPostsUsecase.listReplies.mockResolvedValue(mockResult);

      const result = await controller.listReplies('42', { page: 1, perPage: 20 });

      expect(mockPostsUsecase.listReplies).toHaveBeenCalledWith('42', { page: 1, perPage: 20 });
      expect(result).toBe(mockResult);
    });
  });

  describe('createReply', () => {
    it('should delegate to PostsUsecase.createReply', () => {
      mockPostsUsecase.createReply.mockImplementation(() => {
        throw new NotImplementedException('PostsUsecase.createReply');
      });

      expect(() => controller.createReply('1', { content: 'reply' }, 1)).toThrow(
        NotImplementedException,
      );
      expect(mockPostsUsecase.createReply).toHaveBeenCalledWith('1', { content: 'reply' });
    });
  });

  describe('deleteReply', () => {
    it('should delegate to PostsUsecase.deleteReply', () => {
      mockPostsUsecase.deleteReply.mockImplementation(() => {
        throw new NotImplementedException('PostsUsecase.deleteReply');
      });

      expect(() => controller.deleteReply('1', 'r1', 1)).toThrow(NotImplementedException);
      expect(mockPostsUsecase.deleteReply).toHaveBeenCalledWith('1', 'r1');
    });
  });
});
