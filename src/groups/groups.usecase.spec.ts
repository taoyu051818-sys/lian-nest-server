import { GroupsUsecase } from './groups.usecase';
import { NodebbGroupsProvider } from '../nodebb/providers/nodebb-groups.provider';
import { BodyStatus } from '../nodebb/types';

describe('GroupsUsecase', () => {
  let usecase: GroupsUsecase;
  let provider: NodebbGroupsProvider;

  beforeEach(() => {
    provider = { list: jest.fn() } as unknown as NodebbGroupsProvider;
    usecase = new GroupsUsecase(provider);
  });

  describe('list', () => {
    it('should return mapped groups from nodebb on success', async () => {
      jest.spyOn(provider, 'list').mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: [
          {
            name: 'developers',
            slug: 'developers',
            description: 'Dev group',
            memberCount: 42,
            hidden: 0,
            deleted: 0,
            system: 0,
            createtime: 1700000000,
          },
        ],
        error: null,
      });

      const result = await usecase.list();
      expect(result.source).toBe('nodebb');
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0]).toEqual({
        name: 'developers',
        slug: 'developers',
        description: 'Dev group',
        memberCount: 42,
        hidden: false,
        deleted: false,
        createtime: 1700000000,
      });
    });

    // Regression: parity fixture groups-list-empty
    it('should return empty nodebb list when provider returns empty array', async () => {
      jest.spyOn(provider, 'list').mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: [],
        error: null,
      });

      const result = await usecase.list();
      expect(result.groups).toEqual([]);
      expect(result.source).toBe('nodebb');
    });

    // Regression: parity fixture groups-list-fallback
    it('should return fallback when provider returns error status', async () => {
      jest.spyOn(provider, 'list').mockResolvedValue({
        status: BodyStatus.ERROR,
        statusCode: 500,
        data: null,
        error: 'upstream failure',
      });

      const result = await usecase.list();
      expect(result.groups).toEqual([]);
      expect(result.source).toBe('fallback');
    });

    it('should return fallback when provider returns not_found status', async () => {
      jest.spyOn(provider, 'list').mockResolvedValue({
        status: BodyStatus.NOT_FOUND,
        statusCode: 404,
        data: null,
        error: 'not found',
      });

      const result = await usecase.list();
      expect(result.groups).toEqual([]);
      expect(result.source).toBe('fallback');
    });

    it('should return fallback when provider returns OK but null data', async () => {
      jest.spyOn(provider, 'list').mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: null,
        error: null,
      });

      const result = await usecase.list();
      expect(result.groups).toEqual([]);
      expect(result.source).toBe('fallback');
    });

    it('should return fallback when provider throws', async () => {
      jest.spyOn(provider, 'list').mockRejectedValue(new Error('connection refused'));

      const result = await usecase.list();
      expect(result.groups).toEqual([]);
      expect(result.source).toBe('fallback');
    });

    it('should filter out deleted and system groups', async () => {
      jest.spyOn(provider, 'list').mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: [
          { name: 'a', slug: 'a', description: '', memberCount: 0, hidden: 0, deleted: 0, system: 0, createtime: 0 },
          { name: 'b', slug: 'b', description: '', memberCount: 0, hidden: 0, deleted: 1, system: 0, createtime: 0 },
          { name: 'c', slug: 'c', description: '', memberCount: 0, hidden: 0, deleted: 0, system: 1, createtime: 0 },
        ],
        error: null,
      });

      const result = await usecase.list();
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].name).toBe('a');
    });

    it('should map hidden/deleted from number to boolean', async () => {
      jest.spyOn(provider, 'list').mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: [
          { name: 'x', slug: 'x', description: '', memberCount: 0, hidden: 1, deleted: 0, system: 0, createtime: 0 },
        ],
        error: null,
      });

      const result = await usecase.list();
      expect(result.groups[0].hidden).toBe(true);
      expect(result.groups[0].deleted).toBe(false);
    });
  });
});
