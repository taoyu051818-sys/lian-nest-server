import { Test, TestingModule } from '@nestjs/testing';
import { GetFeedUsecase } from './get-feed.usecase';
import { NodebbTopicsProvider } from '../../nodebb/providers/nodebb-topics.provider';
import { NodebbPostsProvider } from '../../nodebb/providers/nodebb-posts.provider';
import { NodebbUsersProvider } from '../../nodebb/providers/nodebb-users.provider';
import { BodyStatus, normalizeOk, normalizeError } from '../../nodebb/types';

describe('GetFeedUsecase', () => {
  let usecase: GetFeedUsecase;
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
        GetFeedUsecase,
        { provide: NodebbTopicsProvider, useValue: mockTopicsProvider },
        { provide: NodebbPostsProvider, useValue: mockPostsProvider },
        { provide: NodebbUsersProvider, useValue: mockUsersProvider },
      ],
    }).compile();

    usecase = module.get(GetFeedUsecase);
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

  it('should return mapped feed items with defaults (page=1, perPage=20)', async () => {
    topicsProvider.list.mockResolvedValue(
      normalizeOk({ topics: [topic] }),
    );
    postsProvider.getByPid.mockResolvedValue(
      normalizeOk({ pid: 100, tid: 10, uid: 5, content: 'Hello world content', timestamp: 1700000000 }),
    );
    usersProvider.getByUid.mockResolvedValue(
      normalizeOk({ uid: 5, username: 'alice', userslug: 'alice', joindate: 1700000000, reputation: 0, postcount: 10 }),
    );

    const result = await usecase.execute({ userId: 0 });

    expect(result.page).toBe(1);
    expect(result.perPage).toBe(20);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual({
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

  it('should respect explicit pagination params', async () => {
    topicsProvider.list.mockResolvedValue(normalizeOk({ topics: [] }));

    const result = await usecase.execute({ page: 2, perPage: 5, userId: 0 });

    expect(topicsProvider.list).toHaveBeenCalledWith({ page: 2 });
    expect(result.page).toBe(2);
    expect(result.perPage).toBe(5);
  });

  it('should return empty items when topics list is empty', async () => {
    topicsProvider.list.mockResolvedValue(normalizeOk({ topics: [] }));

    const result = await usecase.execute({ userId: 0 });

    expect(result.items).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  it('should return empty items when topics provider returns error', async () => {
    topicsProvider.list.mockResolvedValue(normalizeError(500, 'Internal error'));

    const result = await usecase.execute({ userId: 0 });

    expect(result.items).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  it('should truncate snippet to 200 chars', async () => {
    const longContent = 'x'.repeat(300);
    topicsProvider.list.mockResolvedValue(normalizeOk({ topics: [topic] }));
    postsProvider.getByPid.mockResolvedValue(
      normalizeOk({ pid: 100, tid: 10, uid: 5, content: longContent, timestamp: 1700000000 }),
    );
    usersProvider.getByUid.mockResolvedValue(
      normalizeOk({ uid: 5, username: 'alice', userslug: 'alice', joindate: 1700000000, reputation: 0, postcount: 10 }),
    );

    const result = await usecase.execute({ userId: 0 });

    expect(result.items[0].snippet).toHaveLength(200);
  });

  it('should fallback to empty snippet when post not found', async () => {
    topicsProvider.list.mockResolvedValue(normalizeOk({ topics: [topic] }));
    postsProvider.getByPid.mockResolvedValue(normalizeError(404, 'Not found'));
    usersProvider.getByUid.mockResolvedValue(
      normalizeOk({ uid: 5, username: 'alice', userslug: 'alice', joindate: 1700000000, reputation: 0, postcount: 10 }),
    );

    const result = await usecase.execute({ userId: 0 });

    expect(result.items[0].snippet).toBe('');
  });

  it('should fallback to unknown username when user not found', async () => {
    topicsProvider.list.mockResolvedValue(normalizeOk({ topics: [topic] }));
    postsProvider.getByPid.mockResolvedValue(
      normalizeOk({ pid: 100, tid: 10, uid: 5, content: 'content', timestamp: 1700000000 }),
    );
    usersProvider.getByUid.mockResolvedValue(normalizeError(404, 'Not found'));

    const result = await usecase.execute({ userId: 0 });

    expect(result.items[0].authorUsername).toBe('unknown');
  });
});
