import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { GetFeedItemUsecase } from './get-feed-item.usecase';
import { NodebbTopicsProvider } from '../../nodebb/providers/nodebb-topics.provider';
import { NodebbPostsProvider } from '../../nodebb/providers/nodebb-posts.provider';
import { NodebbUsersProvider } from '../../nodebb/providers/nodebb-users.provider';
import { BodyStatus, normalizeOk, normalizeError } from '../../nodebb/types';

describe('GetFeedItemUsecase', () => {
  let usecase: GetFeedItemUsecase;
  let topicsProvider: jest.Mocked<NodebbTopicsProvider>;
  let postsProvider: jest.Mocked<NodebbPostsProvider>;
  let usersProvider: jest.Mocked<NodebbUsersProvider>;

  beforeEach(async () => {
    const mockTopicsProvider = {
      list: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    const mockPostsProvider = {
      getByPid: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    const mockUsersProvider = {
      getByUid: jest.fn(),
      getBySlug: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetFeedItemUsecase,
        { provide: NodebbTopicsProvider, useValue: mockTopicsProvider },
        { provide: NodebbPostsProvider, useValue: mockPostsProvider },
        { provide: NodebbUsersProvider, useValue: mockUsersProvider },
      ],
    }).compile();

    usecase = module.get(GetFeedItemUsecase);
    topicsProvider = module.get(NodebbTopicsProvider);
    postsProvider = module.get(NodebbPostsProvider);
    usersProvider = module.get(NodebbUsersProvider);
  });

  const topic = {
    tid: 10,
    uid: 5,
    cid: 1,
    title: 'Test Topic',
    slug: 'test-topic',
    mainPid: 100,
    postcount: 3,
    viewcount: 50,
    timestamp: 1700000000,
  };

  it('should return a mapped feed item for a valid feedItemId', async () => {
    topicsProvider.getById.mockResolvedValue(normalizeOk(topic));
    postsProvider.getByPid.mockResolvedValue(
      normalizeOk({ pid: 100, tid: 10, uid: 5, content: 'Hello world content', timestamp: 1700000000 }),
    );
    usersProvider.getByUid.mockResolvedValue(
      normalizeOk({ uid: 5, username: 'alice', userslug: 'alice', joindate: 1700000000, reputation: 0, postcount: 10 }),
    );

    const result = await usecase.execute({ feedItemId: 't10', userId: 0 });

    expect(topicsProvider.getById).toHaveBeenCalledWith(10);
    expect(result).toEqual({
      id: 't10',
      postId: 100,
      topicId: 10,
      title: 'Test Topic',
      snippet: 'Hello world content',
      authorUid: 5,
      authorUsername: 'alice',
      createdAt: new Date(1700000000 * 1000).toISOString(),
    });
  });

  it('should truncate snippet to 200 chars', async () => {
    const longContent = 'x'.repeat(300);
    topicsProvider.getById.mockResolvedValue(normalizeOk(topic));
    postsProvider.getByPid.mockResolvedValue(
      normalizeOk({ pid: 100, tid: 10, uid: 5, content: longContent, timestamp: 1700000000 }),
    );
    usersProvider.getByUid.mockResolvedValue(
      normalizeOk({ uid: 5, username: 'alice', userslug: 'alice', joindate: 1700000000, reputation: 0, postcount: 10 }),
    );

    const result = await usecase.execute({ feedItemId: 't10', userId: 0 });

    expect(result.snippet).toHaveLength(200);
  });

  it('should fallback to empty snippet when post not found', async () => {
    topicsProvider.getById.mockResolvedValue(normalizeOk(topic));
    postsProvider.getByPid.mockResolvedValue(normalizeError(404, 'Not found'));
    usersProvider.getByUid.mockResolvedValue(
      normalizeOk({ uid: 5, username: 'alice', userslug: 'alice', joindate: 1700000000, reputation: 0, postcount: 10 }),
    );

    const result = await usecase.execute({ feedItemId: 't10', userId: 0 });

    expect(result.snippet).toBe('');
  });

  it('should fallback to unknown username when user not found', async () => {
    topicsProvider.getById.mockResolvedValue(normalizeOk(topic));
    postsProvider.getByPid.mockResolvedValue(
      normalizeOk({ pid: 100, tid: 10, uid: 5, content: 'content', timestamp: 1700000000 }),
    );
    usersProvider.getByUid.mockResolvedValue(normalizeError(404, 'Not found'));

    const result = await usecase.execute({ feedItemId: 't10', userId: 0 });

    expect(result.authorUsername).toBe('unknown');
  });

  it('should throw NotFoundException when topic is not found', async () => {
    topicsProvider.getById.mockResolvedValue(normalizeError(404, 'Not found'));

    await expect(usecase.execute({ feedItemId: 't999', userId: 0 })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should throw NotFoundException when topics provider returns error', async () => {
    topicsProvider.getById.mockResolvedValue(normalizeError(500, 'Internal error'));

    await expect(usecase.execute({ feedItemId: 't10', userId: 0 })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should throw NotFoundException for invalid feedItemId format (no t prefix)', async () => {
    await expect(usecase.execute({ feedItemId: '10', userId: 0 })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should throw NotFoundException for empty feedItemId', async () => {
    await expect(usecase.execute({ feedItemId: '', userId: 0 })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should throw NotFoundException for non-numeric feedItemId', async () => {
    await expect(usecase.execute({ feedItemId: 'tabc', userId: 0 })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should throw NotFoundException for feedItemId with extra characters', async () => {
    await expect(usecase.execute({ feedItemId: 't10abc', userId: 0 })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should convert timestamp to ISO string', async () => {
    topicsProvider.getById.mockResolvedValue(normalizeOk(topic));
    postsProvider.getByPid.mockResolvedValue(
      normalizeOk({ pid: 100, tid: 10, uid: 5, content: 'content', timestamp: 1700000000 }),
    );
    usersProvider.getByUid.mockResolvedValue(
      normalizeOk({ uid: 5, username: 'alice', userslug: 'alice', joindate: 1700000000, reputation: 0, postcount: 10 }),
    );

    const result = await usecase.execute({ feedItemId: 't10', userId: 0 });

    expect(result.createdAt).toBe(new Date(1700000000 * 1000).toISOString());
    expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('should handle concurrent post and user fetches', async () => {
    topicsProvider.getById.mockResolvedValue(normalizeOk(topic));
    postsProvider.getByPid.mockResolvedValue(
      normalizeOk({ pid: 100, tid: 10, uid: 5, content: 'content', timestamp: 1700000000 }),
    );
    usersProvider.getByUid.mockResolvedValue(
      normalizeOk({ uid: 5, username: 'alice', userslug: 'alice', joindate: 1700000000, reputation: 0, postcount: 10 }),
    );

    await usecase.execute({ feedItemId: 't10', userId: 0 });

    expect(postsProvider.getByPid).toHaveBeenCalledWith(100);
    expect(usersProvider.getByUid).toHaveBeenCalledWith(5);
  });
});
