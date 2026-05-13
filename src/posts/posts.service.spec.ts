import { Test, TestingModule } from '@nestjs/testing';
import { NotImplementedException, NotFoundException } from '@nestjs/common';
import { PostsUsecase } from './posts.service';
import { NodebbPostsProvider, NodebbTopicsProvider, BodyStatus } from '../nodebb';
import { PostReactionType } from './types';

const mockPostsProvider = {
  getByPid: jest.fn(),
  getByTid: jest.fn(),
};

const mockTopicsProvider = {
  getById: jest.fn(),
  list: jest.fn(),
};

describe('PostsUsecase', () => {
  let service: PostsUsecase;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostsUsecase,
        { provide: NodebbPostsProvider, useValue: mockPostsProvider },
        { provide: NodebbTopicsProvider, useValue: mockTopicsProvider },
      ],
    }).compile();

    service = module.get<PostsUsecase>(PostsUsecase);
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
    const mockTopics = [
      { tid: 1, uid: 5, cid: 2, title: 'Topic A', slug: 'topic-a', mainPid: 10, postcount: 3, viewcount: 50, timestamp: 1700000000 },
      { tid: 2, uid: 6, cid: 2, title: 'Topic B', slug: 'topic-b', mainPid: 20, postcount: 1, viewcount: 10, timestamp: 1700001000 },
    ];

    it('should return mapped post list from topics', async () => {
      mockTopicsProvider.list.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: { topics: mockTopics },
        error: null,
      });

      const result = await service.listPosts({ page: 1, perPage: 20 });

      expect(result.items).toHaveLength(2);
      expect(result.items[0].id).toBe('10');
      expect(result.items[0].content).toBe('Topic A');
      expect(result.items[0].author.uid).toBe(5);
      expect(result.items[0].replyCount).toBe(2);
      expect(result.items[1].id).toBe('20');
      expect(result.items[1].replyCount).toBe(0);
      expect(result.totalCount).toBe(2);
      expect(result.page).toBe(1);
      expect(result.perPage).toBe(20);
    });

    it('should return empty list when topics fetch fails', async () => {
      mockTopicsProvider.list.mockResolvedValue({
        status: BodyStatus.NOT_FOUND,
        statusCode: 404,
        data: null,
        error: 'not found',
      });

      const result = await service.listPosts({});

      expect(result.items).toHaveLength(0);
      expect(result.totalCount).toBe(0);
    });

    it('should default pagination when not provided', async () => {
      mockTopicsProvider.list.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: { topics: [] },
        error: null,
      });

      const result = await service.listPosts({});

      expect(result.page).toBe(1);
      expect(result.perPage).toBe(20);
    });

    it('should coerce invalid pagination to defaults', async () => {
      mockTopicsProvider.list.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: { topics: [] },
        error: null,
      });

      const result = await service.listPosts({ page: -5, perPage: 999 });

      expect(result.page).toBe(1);
      expect(result.perPage).toBe(100);
    });

    it('should coerce page=0 to 1', async () => {
      mockTopicsProvider.list.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: { topics: [] },
        error: null,
      });

      const result = await service.listPosts({ page: 0, perPage: 20 });

      expect(result.page).toBe(1);
      expect(result.perPage).toBe(20);
    });

    it('should coerce perPage=0 to default 20', async () => {
      mockTopicsProvider.list.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: { topics: [] },
        error: null,
      });

      const result = await service.listPosts({ page: 1, perPage: 0 });

      expect(result.page).toBe(1);
      expect(result.perPage).toBe(20);
    });

    it('should coerce non-numeric string params to defaults', async () => {
      mockTopicsProvider.list.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: { topics: [] },
        error: null,
      });

      const result = await service.listPosts({ page: 'abc' as any, perPage: 'xyz' as any });

      expect(result.page).toBe(1);
      expect(result.perPage).toBe(20);
    });

    it('should floor decimal pagination values', async () => {
      mockTopicsProvider.list.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: { topics: [] },
        error: null,
      });

      const result = await service.listPosts({ page: 2.9, perPage: 15.7 });

      expect(result.page).toBe(2);
      expect(result.perPage).toBe(15);
    });

    it('should clamp perPage=101 to 100', async () => {
      mockTopicsProvider.list.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: { topics: [] },
        error: null,
      });

      const result = await service.listPosts({ page: 1, perPage: 101 });

      expect(result.perPage).toBe(100);
    });

    it('should allow perPage=1 at minimum boundary', async () => {
      mockTopicsProvider.list.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: { topics: [] },
        error: null,
      });

      const result = await service.listPosts({ page: 1, perPage: 1 });

      expect(result.perPage).toBe(1);
    });

    it('should coerce negative perPage to 1', async () => {
      mockTopicsProvider.list.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: { topics: [] },
        error: null,
      });

      const result = await service.listPosts({ page: 1, perPage: -10 });

      expect(result.perPage).toBe(1);
    });

    it('should normalize empty list when upstream returns null data with OK status', async () => {
      mockTopicsProvider.list.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: null,
        error: null,
      });

      const result = await service.listPosts({ page: 1, perPage: 20 });

      expect(result.items).toHaveLength(0);
      expect(result.totalCount).toBe(0);
      expect(result.page).toBe(1);
      expect(result.perPage).toBe(20);
    });

    it('should normalize empty list when topics array is undefined', async () => {
      mockTopicsProvider.list.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: {},
        error: null,
      });

      const result = await service.listPosts({ page: 1, perPage: 20 });

      expect(result.items).toHaveLength(0);
      expect(result.totalCount).toBe(0);
    });

    it('should return empty items when topics array is empty', async () => {
      mockTopicsProvider.list.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: { topics: [] },
        error: null,
      });

      const result = await service.listPosts({ page: 1, perPage: 20 });

      expect(result.items).toHaveLength(0);
      expect(result.totalCount).toBe(0);
      expect(result.page).toBe(1);
      expect(result.perPage).toBe(20);
    });

    it('should preserve normalized page/perPage in empty list response', async () => {
      mockTopicsProvider.list.mockResolvedValue({
        status: BodyStatus.NOT_FOUND,
        statusCode: 404,
        data: null,
        error: 'not found',
      });

      const result = await service.listPosts({ page: -3, perPage: 500 });

      expect(result.items).toHaveLength(0);
      expect(result.totalCount).toBe(0);
      expect(result.page).toBe(1);
      expect(result.perPage).toBe(100);
    });

    it('should format createdAt as ISO string', async () => {
      mockTopicsProvider.list.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: { topics: [mockTopics[0]] },
        error: null,
      });

      const result = await service.listPosts({});

      expect(result.items[0].createdAt).toBe(new Date(1700000000 * 1000).toISOString());
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
    const mockPost = {
      pid: 42,
      tid: 10,
      uid: 5,
      content: 'Hello world',
      timestamp: 1700000000,
    };

    it('should return empty reaction summary for all types', async () => {
      mockPostsProvider.getByPid.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: mockPost,
        error: null,
      });

      const result = await service.listReactions('42');

      expect(result).toHaveLength(Object.values(PostReactionType).length);
      expect(result[0]).toEqual({ type: 'like', count: 0, reactedByMe: false });
      expect(result.every((r) => r.count === 0 && r.reactedByMe === false)).toBe(true);
    });

    it('should throw NotFoundException for invalid postId', async () => {
      await expect(service.listReactions('abc')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when post not found', async () => {
      mockPostsProvider.getByPid.mockResolvedValue({
        status: BodyStatus.NOT_FOUND,
        statusCode: 404,
        data: null,
        error: 'not found',
      });

      await expect(service.listReactions('999')).rejects.toThrow(
        NotFoundException,
      );
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
    const parentPost = {
      pid: 42,
      tid: 10,
      uid: 5,
      content: 'Parent post',
      timestamp: 1700000000,
    };

    it('should return mapped replies for a valid post', async () => {
      mockPostsProvider.getByPid.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: parentPost,
        error: null,
      });
      mockPostsProvider.getByTid.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: {
          posts: [
            parentPost,
            { pid: 43, tid: 10, uid: 6, content: 'Reply 1', timestamp: 1700000100 },
            { pid: 44, tid: 10, uid: 7, content: 'Reply 2', timestamp: 1700000200, edited: 1700000300 },
          ],
          postcount: 3,
        },
        error: null,
      });

      const result = await service.listReplies('42', { page: 1, perPage: 20 });

      expect(result.items).toHaveLength(2);
      expect(result.items[0].id).toBe('43');
      expect(result.items[0].postId).toBe('42');
      expect(result.items[0].content).toBe('Reply 1');
      expect(result.items[0].author.uid).toBe(6);
      expect(result.items[1].id).toBe('44');
      expect(result.items[1].updatedAt).toBeDefined();
      expect(result.totalCount).toBe(2);
      expect(result.page).toBe(1);
      expect(result.perPage).toBe(20);
    });

    it('should return empty items when topic has no posts', async () => {
      mockPostsProvider.getByPid.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: parentPost,
        error: null,
      });
      mockPostsProvider.getByTid.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: { posts: [], postcount: 1 },
        error: null,
      });

      const result = await service.listReplies('42', {});

      expect(result.items).toHaveLength(0);
      expect(result.totalCount).toBe(0);
    });

    it('should throw NotFoundException for invalid postId', async () => {
      await expect(service.listReplies('abc', {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when parent post not found', async () => {
      mockPostsProvider.getByPid.mockResolvedValue({
        status: BodyStatus.NOT_FOUND,
        statusCode: 404,
        data: null,
        error: 'not found',
      });

      await expect(service.listReplies('999', {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return empty when topic fetch fails', async () => {
      mockPostsProvider.getByPid.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: parentPost,
        error: null,
      });
      mockPostsProvider.getByTid.mockResolvedValue({
        status: BodyStatus.NOT_FOUND,
        statusCode: 404,
        data: null,
        error: 'not found',
      });

      const result = await service.listReplies('42', {});

      expect(result.items).toHaveLength(0);
      expect(result.totalCount).toBe(0);
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
