import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PostsUsecase } from './posts.service';
import { NodebbPostsProvider, NodebbTopicsProvider, NodebbUsersProvider, BodyStatus } from '../nodebb';
import { PostReactionType } from './types';

const mockPostsProvider = {
  getByPid: jest.fn(),
};

const mockTopicsProvider = {
  getById: jest.fn(),
  list: jest.fn(),
};

const mockUsersProvider = {
  getByUid: jest.fn(),
};

describe('PostsUsecase.listReactions – edge cases', () => {
  let service: PostsUsecase;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostsUsecase,
        { provide: NodebbPostsProvider, useValue: mockPostsProvider },
        { provide: NodebbTopicsProvider, useValue: mockTopicsProvider },
        { provide: NodebbUsersProvider, useValue: mockUsersProvider },
      ],
    }).compile();

    service = module.get<PostsUsecase>(PostsUsecase);
    jest.clearAllMocks();
  });

  // ---- pid < 1 branch (finite but below threshold) -------------------------

  it('should throw NotFoundException for postId "0"', async () => {
    await expect(service.listReactions('0')).rejects.toThrow(NotFoundException);
  });

  it('should throw NotFoundException for empty string postId', async () => {
    await expect(service.listReactions('')).rejects.toThrow(NotFoundException);
  });

  it('should throw NotFoundException for negative postId "-1"', async () => {
    await expect(service.listReactions('-1')).rejects.toThrow(NotFoundException);
  });

  it('should throw NotFoundException for large negative postId "-999"', async () => {
    await expect(service.listReactions('-999')).rejects.toThrow(NotFoundException);
  });

  // ---- !Number.isFinite branch (NaN inputs) ---------------------------------

  it('should throw NotFoundException for special characters "!@#$"', async () => {
    await expect(service.listReactions('!@#$')).rejects.toThrow(NotFoundException);
  });

  it('should throw NotFoundException for string "null"', async () => {
    await expect(service.listReactions('null')).rejects.toThrow(NotFoundException);
  });

  it('should throw NotFoundException for string "undefined"', async () => {
    await expect(service.listReactions('undefined')).rejects.toThrow(NotFoundException);
  });

  it('should throw NotFoundException for whitespace-only string', async () => {
    await expect(service.listReactions('   ')).rejects.toThrow(NotFoundException);
  });

  // ---- fractional numeric string (passes guard, hits provider) --------------

  it('should throw NotFoundException for fractional postId "1.5" when provider returns NOT_FOUND', async () => {
    mockPostsProvider.getByPid.mockResolvedValue({
      status: BodyStatus.NOT_FOUND,
      statusCode: 404,
      data: null,
      error: 'not found',
    });

    await expect(service.listReactions('1.5')).rejects.toThrow(NotFoundException);
    expect(mockPostsProvider.getByPid).toHaveBeenCalledWith(1.5);
  });

  // ---- provider returns OK status but null data -----------------------------

  it('should throw NotFoundException when provider returns OK status with null data', async () => {
    mockPostsProvider.getByPid.mockResolvedValue({
      status: BodyStatus.OK,
      statusCode: 200,
      data: null,
      error: null,
    });

    await expect(service.listReactions('42')).rejects.toThrow(NotFoundException);
  });

  // ---- empty provider shape (all reaction types with zero counts) -----------

  it('should return all six reaction types with zero counts for a valid post', async () => {
    mockPostsProvider.getByPid.mockResolvedValue({
      status: BodyStatus.OK,
      statusCode: 200,
      data: { pid: 42, tid: 10, uid: 5, content: 'test', timestamp: 1700000000 },
      error: null,
    });

    const result = await service.listReactions('42');

    expect(result).toHaveLength(6);
    expect(result.every((r) => r.count === 0 && r.reactedByMe === false)).toBe(true);
  });

  it('should include every PostReactionType enum value in response', async () => {
    mockPostsProvider.getByPid.mockResolvedValue({
      status: BodyStatus.OK,
      statusCode: 200,
      data: { pid: 42, tid: 10, uid: 5, content: 'test', timestamp: 1700000000 },
      error: null,
    });

    const result = await service.listReactions('42');
    const types = result.map((r) => r.type);

    expect(types).toContain(PostReactionType.LIKE);
    expect(types).toContain(PostReactionType.LOVE);
    expect(types).toContain(PostReactionType.HAHA);
    expect(types).toContain(PostReactionType.WOW);
    expect(types).toContain(PostReactionType.SAD);
    expect(types).toContain(PostReactionType.ANGRY);
  });

  it('should return reactions in the same order as PostReactionType enum', async () => {
    mockPostsProvider.getByPid.mockResolvedValue({
      status: BodyStatus.OK,
      statusCode: 200,
      data: { pid: 42, tid: 10, uid: 5, content: 'test', timestamp: 1700000000 },
      error: null,
    });

    const result = await service.listReactions('42');
    const expected = Object.values(PostReactionType);

    expect(result.map((r) => r.type)).toEqual(expected);
  });
});
