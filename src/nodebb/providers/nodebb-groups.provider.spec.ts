import { NodebbGroupsProvider, NodebbGroup } from './nodebb-groups.provider';
import { NodebbClient, NODEBB_CLIENT } from '../nodebb-client';
import {
  NodebbAuth,
  NodebbAuthMode,
  NodebbNormalizedResponse,
  BodyStatus,
  normalizeOk,
  normalizeError,
} from '../types';

function createMockClient(overrides: Partial<NodebbClient> = {}): NodebbClient {
  return {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    ...overrides,
  } as unknown as NodebbClient;
}

const emptyGroupsResponse: NodebbGroup[] = [];

const populatedGroupsResponse: NodebbGroup[] = [
  {
    name: 'Administrators',
    slug: 'administrators',
    description: 'Forum administrators',
    memberCount: 3,
    hidden: 0,
    deleted: 0,
    system: 1,
    createtime: 1700000000,
  },
  {
    name: 'Moderators',
    slug: 'moderators',
    description: 'Forum moderators',
    memberCount: 10,
    hidden: 0,
    deleted: 0,
    system: 1,
    createtime: 1700000100,
    cover: { thumb: '/thumb.png', url: '/cover.png' },
  },
  {
    name: 'Developers',
    slug: 'developers',
    description: 'Open-source contributors',
    memberCount: 25,
    hidden: 0,
    deleted: 0,
    system: 0,
    createtime: 1700000200,
  },
];

describe('NodebbGroupsProvider', () => {
  let provider: NodebbGroupsProvider;
  let client: NodebbClient;

  beforeEach(() => {
    client = createMockClient();
    provider = new NodebbGroupsProvider(client);
  });

  describe('endpoint path', () => {
    it('calls /api/v3/groups', async () => {
      (client.get as jest.Mock).mockResolvedValue(normalizeOk(emptyGroupsResponse));

      await provider.list();

      expect(client.get).toHaveBeenCalledWith(
        '/api/v3/groups',
        undefined,
      );
    });
  });

  describe('auth passthrough', () => {
    it('passes auth to client.get when provided', async () => {
      (client.get as jest.Mock).mockResolvedValue(normalizeOk(emptyGroupsResponse));
      const auth: NodebbAuth = { mode: NodebbAuthMode.API_TOKEN, token: 'tok' };

      await provider.list(auth);

      expect(client.get).toHaveBeenCalledWith('/api/v3/groups', auth);
    });

    it('passes undefined auth when omitted', async () => {
      (client.get as jest.Mock).mockResolvedValue(normalizeOk(emptyGroupsResponse));

      await provider.list();

      expect(client.get).toHaveBeenCalledWith('/api/v3/groups', undefined);
    });

    it('passes session auth when provided', async () => {
      (client.get as jest.Mock).mockResolvedValue(normalizeOk(emptyGroupsResponse));
      const auth: NodebbAuth = { mode: NodebbAuthMode.SESSION, sessionCookie: 'abc' };

      await provider.list(auth);

      expect(client.get).toHaveBeenCalledWith('/api/v3/groups', auth);
    });
  });

  describe('successful responses', () => {
    it('returns OK envelope with populated groups', async () => {
      const envelope = normalizeOk(populatedGroupsResponse);
      (client.get as jest.Mock).mockResolvedValue(envelope);

      const result = await provider.list();

      expect(result.status).toBe(BodyStatus.OK);
      expect(result.statusCode).toBe(200);
      expect(result.data).toEqual(populatedGroupsResponse);
      expect(result.data).toHaveLength(3);
      expect(result.error).toBeNull();
    });

    it('returns OK envelope with empty groups array', async () => {
      const envelope = normalizeOk(emptyGroupsResponse);
      (client.get as jest.Mock).mockResolvedValue(envelope);

      const result = await provider.list();

      expect(result.status).toBe(BodyStatus.OK);
      expect(result.statusCode).toBe(200);
      expect(result.data).toEqual([]);
      expect(result.data).toHaveLength(0);
      expect(result.error).toBeNull();
    });

    it('preserves all NodebbGroup fields in response', async () => {
      const group: NodebbGroup = {
        name: 'Full Fields',
        slug: 'full-fields',
        description: 'A group with all fields',
        memberCount: 5,
        hidden: 1,
        deleted: 0,
        system: 0,
        createtime: 1700000300,
        cover: { thumb: '/t.jpg', url: '/c.jpg' },
      };
      const envelope = normalizeOk([group]);
      (client.get as jest.Mock).mockResolvedValue(envelope);

      const result = await provider.list();

      expect(result.data![0]).toEqual(group);
      expect(result.data![0].cover).toBeDefined();
      expect(result.data![0].cover!.thumb).toBe('/t.jpg');
      expect(result.data![0].cover!.url).toBe('/c.jpg');
    });

    it('handles groups without optional cover field', async () => {
      const group: NodebbGroup = {
        name: 'No Cover',
        slug: 'no-cover',
        description: '',
        memberCount: 0,
        hidden: 0,
        deleted: 0,
        system: 0,
        createtime: 1700000400,
      };
      const envelope = normalizeOk([group]);
      (client.get as jest.Mock).mockResolvedValue(envelope);

      const result = await provider.list();

      expect(result.data![0].cover).toBeUndefined();
    });
  });

  describe('error normalization', () => {
    it('returns ERROR envelope for 500 responses', async () => {
      const envelope = normalizeError<NodebbGroup[]>(500, 'Internal Server Error');
      (client.get as jest.Mock).mockResolvedValue(envelope);

      const result = await provider.list();

      expect(result.status).toBe(BodyStatus.ERROR);
      expect(result.statusCode).toBe(500);
      expect(result.data).toBeNull();
      expect(result.error).toBe('Internal Server Error');
    });

    it('returns NOT_FOUND envelope for 404 responses', async () => {
      const envelope = normalizeError<NodebbGroup[]>(404, 'Not Found');
      (client.get as jest.Mock).mockResolvedValue(envelope);

      const result = await provider.list();

      expect(result.status).toBe(BodyStatus.NOT_FOUND);
      expect(result.statusCode).toBe(404);
      expect(result.data).toBeNull();
      expect(result.error).toBe('Not Found');
    });

    it('returns ERROR envelope for 401 responses', async () => {
      const envelope = normalizeError<NodebbGroup[]>(401, 'Unauthorized');
      (client.get as jest.Mock).mockResolvedValue(envelope);

      const result = await provider.list();

      expect(result.status).toBe(BodyStatus.ERROR);
      expect(result.statusCode).toBe(401);
      expect(result.data).toBeNull();
      expect(result.error).toBe('Unauthorized');
    });

    it('returns ERROR envelope for 429 responses', async () => {
      const envelope = normalizeError<NodebbGroup[]>(429, 'Too Many Requests');
      (client.get as jest.Mock).mockResolvedValue(envelope);

      const result = await provider.list();

      expect(result.status).toBe(BodyStatus.ERROR);
      expect(result.statusCode).toBe(429);
      expect(result.error).toBe('Too Many Requests');
    });

    it('returns ERROR envelope for 502 responses', async () => {
      const envelope = normalizeError<NodebbGroup[]>(502, 'Bad Gateway');
      (client.get as jest.Mock).mockResolvedValue(envelope);

      const result = await provider.list();

      expect(result.status).toBe(BodyStatus.ERROR);
      expect(result.statusCode).toBe(502);
      expect(result.error).toBe('Bad Gateway');
    });
  });

  describe('passthrough contract', () => {
    it('returns the exact envelope from the client without transformation', async () => {
      const raw: NodebbNormalizedResponse<NodebbGroup[]> = {
        status: BodyStatus.ERROR,
        statusCode: 503,
        data: null,
        error: 'Service Unavailable',
      };
      (client.get as jest.Mock).mockResolvedValue(raw);

      const result = await provider.list();

      expect(result).toBe(raw);
    });

    it('returns the exact OK envelope reference from the client', async () => {
      const raw = normalizeOk(populatedGroupsResponse);
      (client.get as jest.Mock).mockResolvedValue(raw);

      const result = await provider.list();

      expect(result).toBe(raw);
    });
  });
});
