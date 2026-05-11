import { Test, TestingModule } from '@nestjs/testing';
import { GroupsController } from './groups.controller';
import { GroupsUsecase } from './groups.usecase';
import { NodebbGroupsProvider } from '../nodebb/providers/nodebb-groups.provider';

describe('GroupsController', () => {
  let controller: GroupsController;
  let usecase: GroupsUsecase;

  const mockGroupsProvider = {
    list: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GroupsController],
      providers: [
        GroupsUsecase,
        { provide: NodebbGroupsProvider, useValue: mockGroupsProvider },
      ],
    }).compile();

    controller = module.get<GroupsController>(GroupsController);
    usecase = module.get<GroupsUsecase>(GroupsUsecase);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('list', () => {
    it('should delegate to usecase', async () => {
      const mockResponse = {
        groups: [
          {
            name: 'developers',
            slug: 'developers',
            description: 'Dev group',
            memberCount: 42,
            hidden: false,
            deleted: false,
            createtime: 1700000000,
          },
        ],
        source: 'nodebb' as const,
      };
      const spy = jest.spyOn(usecase, 'list').mockResolvedValue(mockResponse);
      const result = await controller.list();
      expect(spy).toHaveBeenCalled();
      expect(result).toEqual(mockResponse);
    });

    it('should return fallback when usecase returns empty', async () => {
      const mockResponse = {
        groups: [],
        source: 'fallback' as const,
      };
      jest.spyOn(usecase, 'list').mockResolvedValue(mockResponse);
      const result = await controller.list();
      expect(result.groups).toEqual([]);
      expect(result.source).toBe('fallback');
    });
  });
});
