import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { TopicsController } from './topics.controller';
import { TopicsUsecase } from './topics.usecase';
import { NodebbTopicsProvider } from '../nodebb/providers/nodebb-topics.provider';

describe('TopicsController', () => {
  let controller: TopicsController;
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
      controllers: [TopicsController],
      providers: [
        TopicsUsecase,
        { provide: NodebbTopicsProvider, useValue: mockTopicsProvider },
      ],
    }).compile();

    controller = module.get<TopicsController>(TopicsController);
    usecase = module.get<TopicsUsecase>(TopicsUsecase);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getByTid', () => {
    it('should delegate to usecase', async () => {
      const mockTopic = {
        tid: 1, uid: 2, cid: 3, title: 'Test Topic',
        slug: 'test-topic', mainPid: 10,
        postcount: 5, viewcount: 100, timestamp: 1700000000,
        source: 'nodebb' as const,
      };
      const spy = jest.spyOn(usecase, 'getByTid').mockResolvedValue(mockTopic);
      const result = await controller.getByTid('1');
      expect(spy).toHaveBeenCalledWith('1');
      expect(result).toEqual(mockTopic);
    });

    it('should propagate NotFoundException for invalid tid', async () => {
      jest.spyOn(usecase, 'getByTid').mockRejectedValue(
        new NotFoundException('Invalid tid: abc'),
      );
      await expect(controller.getByTid('abc')).rejects.toThrow(NotFoundException);
    });

    it('should propagate NotFoundException for non-existent topic', async () => {
      jest.spyOn(usecase, 'getByTid').mockRejectedValue(
        new NotFoundException('Topic 999 not found'),
      );
      await expect(controller.getByTid('999')).rejects.toThrow(NotFoundException);
    });
  });
});
