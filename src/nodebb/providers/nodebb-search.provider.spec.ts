import { NodebbSearchProvider, NodebbSearchResponse } from './nodebb-search.provider';
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

const emptySearchResponse: NodebbSearchResponse = {
  matches: [],
  matchCount: 0,
  pagination: { page: 1, pageCount: 0, itemsPerPage: 10 },
};

const populatedSearchResponse: NodebbSearchResponse = {
  matches: [
    { id: 1, title: 'Result 1', content: 'Body 1', timestamp: 1000 },
    { id: 2, title: 'Result 2', content: 'Body 2', timestamp: 2000 },
  ],
  matchCount: 2,
  pagination: { page: 1, pageCount: 1, itemsPerPage: 10 },
};

describe('NodebbSearchProvider', () => {
  let provider: NodebbSearchProvider;
  let client: NodebbClient;

  beforeEach(() => {
    client = createMockClient();
    provider = new NodebbSearchProvider(client);
  });

  describe('query parameter construction', () => {
    it('sets term parameter', async () => {
      (client.get as jest.Mock).mockResolvedValue(normalizeOk(emptySearchResponse));

      await provider.search('hello');

      expect(client.get).toHaveBeenCalledWith(
        expect.stringContaining('term=hello'),
        undefined,
      );
    });

    it('sets page parameter when provided', async () => {
      (client.get as jest.Mock).mockResolvedValue(normalizeOk(emptySearchResponse));

      await provider.search('test', { page: 3 });

      const calledPath = (client.get as jest.Mock).mock.calls[0][0] as string;
      expect(calledPath).toContain('term=test');
      expect(calledPath).toContain('page=3');
    });

    it('omits page parameter when not provided', async () => {
      (client.get as jest.Mock).mockResolvedValue(normalizeOk(emptySearchResponse));

      await provider.search('test');

      const calledPath = (client.get as jest.Mock).mock.calls[0][0] as string;
      expect(calledPath).not.toContain('page=');
    });

    it('omits page parameter when page is null', async () => {
      (client.get as jest.Mock).mockResolvedValue(normalizeOk(emptySearchResponse));

      await provider.search('test', { page: null as unknown as number });

      const calledPath = (client.get as jest.Mock).mock.calls[0][0] as string;
      expect(calledPath).not.toContain('page=');
    });

    it('uses /api/v3/search path', async () => {
      (client.get as jest.Mock).mockResolvedValue(normalizeOk(emptySearchResponse));

      await provider.search('q');

      expect(client.get).toHaveBeenCalledWith(
        expect.stringContaining('/api/v3/search?'),
        undefined,
      );
    });
  });

  describe('auth passthrough', () => {
    it('passes auth to client.get when provided', async () => {
      (client.get as jest.Mock).mockResolvedValue(normalizeOk(emptySearchResponse));
      const auth: NodebbAuth = { mode: NodebbAuthMode.API_TOKEN, token: 'tok' };

      await provider.search('q', undefined, auth);

      expect(client.get).toHaveBeenCalledWith(expect.any(String), auth);
    });

    it('passes undefined auth when omitted', async () => {
      (client.get as jest.Mock).mockResolvedValue(normalizeOk(emptySearchResponse));

      await provider.search('q');

      expect(client.get).toHaveBeenCalledWith(expect.any(String), undefined);
    });
  });

  describe('successful responses', () => {
    it('returns OK envelope with populated results', async () => {
      const envelope = normalizeOk(populatedSearchResponse);
      (client.get as jest.Mock).mockResolvedValue(envelope);

      const result = await provider.search('term');

      expect(result.status).toBe(BodyStatus.OK);
      expect(result.statusCode).toBe(200);
      expect(result.data).toEqual(populatedSearchResponse);
      expect(result.error).toBeNull();
    });

    it('returns OK envelope with empty results', async () => {
      const envelope = normalizeOk(emptySearchResponse);
      (client.get as jest.Mock).mockResolvedValue(envelope);

      const result = await provider.search('no-results');

      expect(result.status).toBe(BodyStatus.OK);
      expect(result.statusCode).toBe(200);
      expect(result.data).toEqual(emptySearchResponse);
      expect(result.data!.matches).toHaveLength(0);
      expect(result.data!.matchCount).toBe(0);
      expect(result.error).toBeNull();
    });
  });

  describe('error normalization', () => {
    it('returns ERROR envelope for 500 responses', async () => {
      const envelope = normalizeError<NodebbSearchResponse>(500, 'Internal Server Error');
      (client.get as jest.Mock).mockResolvedValue(envelope);

      const result = await provider.search('q');

      expect(result.status).toBe(BodyStatus.ERROR);
      expect(result.statusCode).toBe(500);
      expect(result.data).toBeNull();
      expect(result.error).toBe('Internal Server Error');
    });

    it('returns NOT_FOUND envelope for 404 responses', async () => {
      const envelope = normalizeError<NodebbSearchResponse>(404, 'Not Found');
      (client.get as jest.Mock).mockResolvedValue(envelope);

      const result = await provider.search('q');

      expect(result.status).toBe(BodyStatus.NOT_FOUND);
      expect(result.statusCode).toBe(404);
      expect(result.data).toBeNull();
      expect(result.error).toBe('Not Found');
    });

    it('returns ERROR envelope for 401 responses', async () => {
      const envelope = normalizeError<NodebbSearchResponse>(401, 'Unauthorized');
      (client.get as jest.Mock).mockResolvedValue(envelope);

      const result = await provider.search('q');

      expect(result.status).toBe(BodyStatus.ERROR);
      expect(result.statusCode).toBe(401);
      expect(result.data).toBeNull();
      expect(result.error).toBe('Unauthorized');
    });

    it('returns ERROR envelope for 429 responses', async () => {
      const envelope = normalizeError<NodebbSearchResponse>(429, 'Too Many Requests');
      (client.get as jest.Mock).mockResolvedValue(envelope);

      const result = await provider.search('q');

      expect(result.status).toBe(BodyStatus.ERROR);
      expect(result.statusCode).toBe(429);
      expect(result.error).toBe('Too Many Requests');
    });

    it('returns ERROR envelope for 502 responses', async () => {
      const envelope = normalizeError<NodebbSearchResponse>(502, 'Bad Gateway');
      (client.get as jest.Mock).mockResolvedValue(envelope);

      const result = await provider.search('q');

      expect(result.status).toBe(BodyStatus.ERROR);
      expect(result.statusCode).toBe(502);
      expect(result.error).toBe('Bad Gateway');
    });
  });

  describe('passthrough contract', () => {
    it('returns the exact envelope from the client without transformation', async () => {
      const raw: NodebbNormalizedResponse<NodebbSearchResponse> = {
        status: BodyStatus.ERROR,
        statusCode: 503,
        data: null,
        error: 'Service Unavailable',
      };
      (client.get as jest.Mock).mockResolvedValue(raw);

      const result = await provider.search('q');

      expect(result).toBe(raw);
    });
  });
});
