import { Test, TestingModule } from '@nestjs/testing';
import { NotImplementedException, NotFoundException } from '@nestjs/common';
import { PostsService } from './posts.service';
import { NodebbPostsProvider, NodebbTopicsProvider, BodyStatus } from '../nodebb';

const mockPostsProvider = {
  getByPid: jest.fn(),
};

const mockTopicsProvider = {
  getById: jest.fn(),
};

describe('PostsService', () => {
  let service: PostsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostsService,
        { provide: NodebbPostsProvider, useValue: mockPostsProvider },
        { provide: NodebbTopicsProvider, useValue: mockTopicsProvider },
      ],
    }).compile();

    service = module.get<PostsService>(PostsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---- Read ----------------------------------------------------------------

  describe('getPostDetail', () => {
    const mockPost = {
      pid: 42,
      tid: 10,
      uid: 5,
      content: 'Hello world',
      timestamp: 1700000000,
    };

    const mockTopic = {
      tid: 10,
      uid: 5,
      cid: 2,
      title: 'Test Topic',
      slug: 'test-topic',
      mainPid: 42,
      postcount: 3,
      viewCount: 100,
      viewcount: 100,
      timestamp: 1699999000,
    };

    it('should return mapped post detail with topic data', async () => {
      mockPostsProvider.getByPid.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: mockPost,
        error: null,
      });
      mockTopicsProvider.getById.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: mockTopic,
        error: null,
      });

      const result = await service.getPostDetail('42');

      expect(result.pid).toBe(42);
      expect(result.tid).toBe(10);
      expect(result.title).toBe('Test Topic');
      expect(result.slug).toBe('test-topic');
      expect(result.content).toBe('Hello world');
      expect(result.author.uid).toBe(5);
      expect(result.timestamp).toBe(1700000000);
      expect(result.isDeleted).toBe(false);
      expect(result.topic.tid).toBe(10);
      expect(result.topic.title).toBe('Test Topic');
      expect(result.topic.cid).toBe(2);
      expect(result.topic.postCount).toBe(3);
      expect(result.topic.viewCount).toBe(100);
    });

    it('should default topic fields when topic fetch fails', async () => {
      mockPostsProvider.getByPid.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: mockPost,
        error: null,
      });
      mockTopicsProvider.getById.mockResolvedValue({
        status: BodyStatus.NOT_FOUND,
        statusCode: 404,
        data: null,
        error: 'not found',
      });

      const result = await service.getPostDetail('42');

      expect(result.pid).toBe(42);
      expect(result.title).toBe('');
      expect(result.topic.tid).toBe(10);
      expect(result.topic.title).toBe('');
      expect(result.topic.cid).toBe(0);
    });

    it('should throw NotFoundException when post not found', async () => {
      mockPostsProvider.getByPid.mockResolvedValue({
        status: BodyStatus.NOT_FOUND,
        statusCode: 404,
        data: null,
        error: 'not found',
      });

      await expect(service.getPostDetail('999')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException for invalid id', async () => {
      await expect(service.getPostDetail('abc')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should map edited timestamp from post', async () => {
      mockPostsProvider.getByPid.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: { ...mockPost, edited: 1700001000 },
        error: null,
      });
      mockTopicsProvider.getById.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: mockTopic,
        error: null,
      });

      const result = await service.getPostDetail('42');

      expect(result.editedTimestamp).toBe(1700001000);
    });

    it('should map deleted flag from post', async () => {
      mockPostsProvider.getByPid.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: { ...mockPost, deleted: true },
        error: null,
      });
      mockTopicsProvider.getById.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: mockTopic,
        error: null,
      });

      const result = await service.getPostDetail('42');

      expect(result.isDeleted).toBe(true);
    });
  });

  // ---- Write (stubs) -------------------------------------------------------

  describe('listPosts', () => {
    it('should throw NotImplementedException', () => {
      expect(() => service.listPosts({})).toThrow(NotImplementedException);
    });
  });

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

  // ---- Reactions (stubs) ---------------------------------------------------

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

  // ---- Replies (stubs) -----------------------------------------------------

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
