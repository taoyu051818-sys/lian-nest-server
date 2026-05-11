import { Test, TestingModule } from '@nestjs/testing';
import { GroupsController } from './groups.controller';
import { GroupsUsecase } from './groups.usecase';
import { NodebbGroupsProvider } from '../nodebb/providers/nodebb-groups.provider';
import { GroupsResponse, GroupItem } from './groups.types';

/**
 * Controller stability edge coverage.
 *
 * Validates that GroupsController is a transparent delegate — it adds no
 * extra keys, coerces no types, and faithfully propagates usecase output.
 *
 * Parity fixture: test/parity/groups/groups-controller-edge.json
 */
describe('GroupsController edge stability', () => {
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

  describe('response key stability', () => {
    // Regression: parity fixture groups-controller-edge / response-key-stability
    it('should return exactly two keys: groups and source (nodebb path)', async () => {
      const mockResponse: GroupsResponse = {
        groups: [
          {
            name: 'devs',
            slug: 'devs',
            description: 'Developers',
            memberCount: 10,
            hidden: false,
            deleted: false,
            createtime: 1700000000,
          },
        ],
        source: 'nodebb',
      };
      jest.spyOn(usecase, 'list').mockResolvedValue(mockResponse);

      const result = await controller.list();
      expect(Object.keys(result).sort()).toEqual(['groups', 'source']);
    });

    // Regression: parity fixture groups-controller-edge / response-key-stability
    it('should return exactly two keys: groups and source (fallback path)', async () => {
      const mockResponse: GroupsResponse = {
        groups: [],
        source: 'fallback',
      };
      jest.spyOn(usecase, 'list').mockResolvedValue(mockResponse);

      const result = await controller.list();
      expect(Object.keys(result).sort()).toEqual(['groups', 'source']);
    });
  });

  describe('source enum constraint', () => {
    // Regression: parity fixture groups-controller-edge / source-enum-constraint
    it('should constrain source to nodebb when usecase returns nodebb', async () => {
      jest.spyOn(usecase, 'list').mockResolvedValue({
        groups: [],
        source: 'nodebb',
      });

      const result = await controller.list();
      expect(['nodebb', 'fallback']).toContain(result.source);
    });

    // Regression: parity fixture groups-controller-edge / source-enum-constraint
    it('should constrain source to fallback when usecase returns fallback', async () => {
      jest.spyOn(usecase, 'list').mockResolvedValue({
        groups: [],
        source: 'fallback',
      });

      const result = await controller.list();
      expect(['nodebb', 'fallback']).toContain(result.source);
    });
  });

  describe('group item field type stability', () => {
    // Regression: parity fixture groups-controller-edge / group-item-field-types
    it('should preserve field types from usecase without coercion', async () => {
      const group: GroupItem = {
        name: 'test-group',
        slug: 'test-group',
        description: 'A test group',
        memberCount: 5,
        hidden: true,
        deleted: false,
        createtime: 1700000000,
      };
      jest.spyOn(usecase, 'list').mockResolvedValue({
        groups: [group],
        source: 'nodebb',
      });

      const result = await controller.list();
      const item = result.groups[0];
      expect(typeof item.name).toBe('string');
      expect(typeof item.slug).toBe('string');
      expect(typeof item.description).toBe('string');
      expect(typeof item.memberCount).toBe('number');
      expect(typeof item.hidden).toBe('boolean');
      expect(typeof item.deleted).toBe('boolean');
      expect(typeof item.createtime).toBe('number');
    });
  });

  describe('result passthrough identity', () => {
    // Regression: parity fixture groups-controller-edge / result-passthrough-identity
    it('should return the exact same object reference from usecase', async () => {
      const mockResponse: GroupsResponse = {
        groups: [
          {
            name: 'x',
            slug: 'x',
            description: '',
            memberCount: 0,
            hidden: false,
            deleted: false,
            createtime: 0,
          },
        ],
        source: 'nodebb',
      };
      jest.spyOn(usecase, 'list').mockResolvedValue(mockResponse);

      const result = await controller.list();
      expect(result).toBe(mockResponse);
    });
  });

  describe('multiple call stability', () => {
    it('should return consistent shape across sequential calls', async () => {
      const responses: GroupsResponse[] = [
        { groups: [], source: 'nodebb' },
        {
          groups: [
            {
              name: 'a',
              slug: 'a',
              description: '',
              memberCount: 1,
              hidden: false,
              deleted: false,
              createtime: 100,
            },
          ],
          source: 'nodebb',
        },
        { groups: [], source: 'fallback' },
      ];
      let callIndex = 0;
      jest.spyOn(usecase, 'list').mockImplementation(async () => responses[callIndex++]);

      for (const expected of responses) {
        const result = await controller.list();
        expect(Object.keys(result).sort()).toEqual(['groups', 'source']);
        expect(Array.isArray(result.groups)).toBe(true);
        expect(typeof result.source).toBe('string');
        expect(result).toEqual(expected);
      }
    });
  });

  describe('groups array stability', () => {
    it('should always return groups as an array, never null or undefined', async () => {
      jest.spyOn(usecase, 'list').mockResolvedValue({
        groups: [],
        source: 'fallback',
      });

      const result = await controller.list();
      expect(Array.isArray(result.groups)).toBe(true);
    });

    it('should preserve mixed hidden/deleted group items without mutation', async () => {
      const groups: GroupItem[] = [
        {
          name: 'visible',
          slug: 'visible',
          description: 'Visible group',
          memberCount: 10,
          hidden: false,
          deleted: false,
          createtime: 1000,
        },
        {
          name: 'hidden-group',
          slug: 'hidden-group',
          description: 'Hidden group',
          memberCount: 3,
          hidden: true,
          deleted: false,
          createtime: 2000,
        },
        {
          name: 'deleted-group',
          slug: 'deleted-group',
          description: 'Deleted group',
          memberCount: 0,
          hidden: false,
          deleted: true,
          createtime: 3000,
        },
      ];
      jest.spyOn(usecase, 'list').mockResolvedValue({
        groups,
        source: 'nodebb',
      });

      const result = await controller.list();
      expect(result.groups).toHaveLength(3);
      expect(result.groups).toBe(groups);
    });
  });
});
