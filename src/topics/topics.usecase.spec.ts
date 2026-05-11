import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { TopicsUsecase } from './topics.usecase';
import { NodebbTopicsProvider } from '../nodebb/providers/nodebb-topics.provider';
import { BodyStatus } from '../nodebb/types';

describe('TopicsUsecase', () => {
  let usecase: TopicsUsecase;

  const mockTopicsProvider = {
    getById: jest.fn(),
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TopicsUsecase,
        { provide: NodebbTopicsProvider, useValue: mockTopicsProvider },
      ],
    }).compile();

    usecase = module.get<TopicsUsecase>(TopicsUsecase);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(usecase).toBeDefined();
  });

  describe('getByTid', () => {
    const mockNodebbTopic = {
      tid: 42,
      uid: 1,
      cid: 2,
      title: 'Test Topic',
      slug: 'test-topic',
      mainPid: 100,
      postcount: 5,
      viewcount: 200,
      timestamp: 1700000000,
    };

    it('should map NodebbTopic to TopicDetail', async () => {
      mockTopicsProvider.getById.mockResolvedValue({
        status: BodyStatus.OK, statusCode: 200,
        data: mockNodebbTopic, error: null,
      });
      const result = await usecase.getByTid('42');
      expect(result).toEqual({
        tid: 42, uid: 1, cid: 2, title: 'Test Topic',
        slug: 'test-topic', mainPid: 100,
        postcount: 5, viewcount: 200, timestamp: 1700000000,
        source: 'nodebb',
      });
      expect(mockTopicsProvider.getById).toHaveBeenCalledWith(42);
    });

    it('should convert tid string to number for provider call', async () => {
      mockTopicsProvider.getById.mockResolvedValue({
        status: BodyStatus.OK, statusCode: 200,
        data: mockNodebbTopic, error: null,
      });
      await usecase.getByTid('42');
      expect(mockTopicsProvider.getById).toHaveBeenCalledWith(42);
    });

    it('should throw NotFoundException for non-numeric tid', async () => {
      await expect(usecase.getByTid('abc')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for zero tid', async () => {
      await expect(usecase.getByTid('0')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for negative tid', async () => {
      await expect(usecase.getByTid('-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for fractional tid', async () => {
      await expect(usecase.getByTid('1.5')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when topic not found', async () => {
      mockTopicsProvider.getById.mockResolvedValue({
        status: BodyStatus.NOT_FOUND, statusCode: 404,
        data: null, error: 'Topic not found',
      });
      await expect(usecase.getByTid('999')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when data is null with error status', async () => {
      mockTopicsProvider.getById.mockResolvedValue({
        status: BodyStatus.ERROR, statusCode: 500,
        data: null, error: 'Internal error',
      });
      await expect(usecase.getByTid('42')).rejects.toThrow(NotFoundException);
    });
  });
});
