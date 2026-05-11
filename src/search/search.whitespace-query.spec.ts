/**
 * Whitespace query normalization coverage.
 * Parity fixture: test/parity/search/search-whitespace-query.json
 *
 * Supplements search.usecase.spec.ts with exhaustive whitespace-type
 * coverage for term trimming and rejection.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SearchUsecase } from './search.usecase';
import { NodebbSearchProvider } from '../nodebb/providers/nodebb-search.provider';
import { BodyStatus } from '../nodebb/types';

describe('SearchUsecase — whitespace query normalization', () => {
  let usecase: SearchUsecase;

  const mockSearchProvider = {
    search: jest.fn(),
  };

  const okResponse = {
    status: BodyStatus.OK,
    statusCode: 200,
    data: {
      matches: [{ id: 1, title: 'Result', content: 'snippet', timestamp: 1700000000 }],
      matchCount: 1,
      pagination: { page: 1, pageCount: 1, itemsPerPage: 20 },
    },
    error: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchUsecase,
        { provide: NodebbSearchProvider, useValue: mockSearchProvider },
      ],
    }).compile();

    usecase = module.get<SearchUsecase>(SearchUsecase);
    jest.clearAllMocks();
    mockSearchProvider.search.mockResolvedValue(okResponse);
  });

  // --- Whitespace-only rejection ---

  describe('whitespace-only term rejection', () => {
    it.each([
      ['spaces', '   '],
      ['tabs', '\t\t'],
      ['newlines', '\n\n'],
      ['carriage returns', '\r\r'],
      ['mixed whitespace', ' \t\n\r '],
    ])('should reject %s-only term', async (_label, term) => {
      await expect(usecase.search(term)).rejects.toThrow(BadRequestException);
    });

    it('should reject whitespace-only term even with page param', async () => {
      await expect(usecase.search('   ', '1')).rejects.toThrow(BadRequestException);
    });
  });

  // --- Leading/trailing whitespace trimming ---

  describe('leading and trailing whitespace trimming', () => {
    it.each([
      ['leading spaces', '  hello', 'hello'],
      ['trailing spaces', 'hello  ', 'hello'],
      ['leading tabs', '\thello', 'hello'],
      ['trailing tabs', 'hello\t', 'hello'],
      ['leading newlines', '\nhello', 'hello'],
      ['trailing newlines', 'hello\n', 'hello'],
      ['leading CR', '\rhello', 'hello'],
      ['trailing CR', 'hello\r', 'hello'],
      ['mixed leading whitespace', '\t \nhello', 'hello'],
      ['mixed trailing whitespace', 'hello\n \t', 'hello'],
    ])('should trim %s', async (_label, input, expected) => {
      const result = await usecase.search(input);
      expect(result.term).toBe(expected);
      expect(mockSearchProvider.search).toHaveBeenCalledWith(expected, { page: 1 });
    });
  });

  // --- Response term field verification ---

  describe('response term field', () => {
    it('should return trimmed term in response when input has leading/trailing spaces', async () => {
      const result = await usecase.search('  hello world  ');
      expect(result.term).toBe('hello world');
    });

    it('should return trimmed term in response when input has leading/trailing tabs', async () => {
      const result = await usecase.search('\thello\t');
      expect(result.term).toBe('hello');
    });

    it('should return trimmed term in response when input has mixed whitespace padding', async () => {
      const result = await usecase.search('\t hello \t');
      expect(result.term).toBe('hello');
    });
  });

  // --- Internal whitespace preservation ---

  describe('internal whitespace preservation', () => {
    it('should preserve multiple internal spaces', async () => {
      const result = await usecase.search('hello   world');
      expect(result.term).toBe('hello   world');
      expect(mockSearchProvider.search).toHaveBeenCalledWith('hello   world', { page: 1 });
    });

    it('should preserve internal tabs', async () => {
      const result = await usecase.search('hello\tworld');
      expect(result.term).toBe('hello\tworld');
    });

    it('should preserve internal newlines', async () => {
      const result = await usecase.search('hello\nworld');
      expect(result.term).toBe('hello\nworld');
    });
  });

  // --- Non-breaking space behavior ---

  describe('non-breaking space (U+00A0)', () => {
    it('should trim non-breaking spaces (ES2019+ trim)', async () => {
      const nbsp = ' ';
      const result = await usecase.search(`${nbsp}hello${nbsp}`);
      // ES2019 updated trim() to strip all Unicode whitespace including U+00A0
      expect(result.term).toBe('hello');
    });

    it('should reject non-breaking-space-only term', async () => {
      await expect(usecase.search('  ')).rejects.toThrow(BadRequestException);
    });
  });

  // --- Whitespace + page interaction ---

  describe('whitespace normalization with page parameter', () => {
    it('should trim term and coerce page together', async () => {
      const result = await usecase.search('  test  ', '3');
      expect(result.term).toBe('test');
      expect(mockSearchProvider.search).toHaveBeenCalledWith('test', { page: 3 });
    });

    it('should reject whitespace-only term regardless of valid page', async () => {
      await expect(usecase.search('\t\t', '1')).rejects.toThrow(BadRequestException);
    });

    it('should trim term but still reject invalid page', async () => {
      await expect(usecase.search('  test  ', 'abc')).rejects.toThrow(BadRequestException);
    });
  });
});
