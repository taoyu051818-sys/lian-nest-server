import { Test, TestingModule } from '@nestjs/testing';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { FeedController } from './feed.controller';
import { GetFeedUsecase, GetFeedItemUsecase } from './usecases';
import { FeedResponseDto, FeedItemDto, FeedQueryDto } from './dto';

describe('FeedController', () => {
  let controller: FeedController;
  let getFeedUsecase: GetFeedUsecase;
  let getFeedItemUsecase: GetFeedItemUsecase;

  const mockFeedResponse: FeedResponseDto = {
    items: [],
    totalCount: 0,
    page: 1,
    perPage: 20,
  };

  const mockFeedItem: FeedItemDto = {
    id: 'item-1',
    postId: 1,
    topicId: 1,
    title: 'Test Post',
    snippet: 'Hello world',
    authorUid: 1,
    authorUsername: 'testuser',
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FeedController],
      providers: [
        {
          provide: GetFeedUsecase,
          useValue: { execute: jest.fn().mockResolvedValue(mockFeedResponse) },
        },
        {
          provide: GetFeedItemUsecase,
          useValue: { execute: jest.fn().mockResolvedValue(mockFeedItem) },
        },
      ],
    }).compile();

    controller = module.get<FeedController>(FeedController);
    getFeedUsecase = module.get<GetFeedUsecase>(GetFeedUsecase);
    getFeedItemUsecase = module.get<GetFeedItemUsecase>(GetFeedItemUsecase);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getFeed', () => {
    it('should delegate to GetFeedUsecase', async () => {
      const result = await controller.getFeed({ page: 1, perPage: 20 });
      expect(getFeedUsecase.execute).toHaveBeenCalledWith({
        page: 1,
        perPage: 20,
        userId: 0,
      });
      expect(result).toEqual(mockFeedResponse);
    });
  });

  describe('getFeedItem', () => {
    it('should delegate to GetFeedItemUsecase', async () => {
      const result = await controller.getFeedItem('item-1');
      expect(getFeedItemUsecase.execute).toHaveBeenCalledWith({
        feedItemId: 'item-1',
        userId: 0,
      });
      expect(result).toEqual(mockFeedItem);
    });
  });
});

describe('FeedQueryDto validation', () => {
  function toDto(raw: Record<string, unknown>): FeedQueryDto {
    return plainToInstance(FeedQueryDto, raw);
  }

  it('should accept valid numeric values', async () => {
    const errors = await validate(toDto({ page: 2, perPage: 10 }));
    expect(errors).toHaveLength(0);
  });

  it('should accept string values and coerce to numbers', async () => {
    const dto = toDto({ page: '3', perPage: '15' });
    expect(dto.page).toBe(3);
    expect(dto.perPage).toBe(15);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should apply page default when no values provided', async () => {
    const dto = toDto({});
    expect(dto.page).toBe(1);
    expect(dto.perPage).toBeUndefined();
    expect(dto.limit).toBeUndefined();
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should reject page less than 1', async () => {
    const errors = await validate(toDto({ page: 0 }));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('page');
  });

  it('should reject perPage less than 1', async () => {
    const errors = await validate(toDto({ perPage: 0 }));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('perPage');
  });

  it('should reject perPage greater than 50', async () => {
    const errors = await validate(toDto({ perPage: 51 }));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('perPage');
  });

  it('should reject non-numeric string values', async () => {
    const dto = toDto({ page: 'abc', perPage: 'xyz' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThanOrEqual(2);
    const props = errors.map((e) => e.property);
    expect(props).toContain('page');
    expect(props).toContain('perPage');
  });

  it('should reject decimal values', async () => {
    const errors = await validate(toDto({ page: 1.5 }));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('page');
  });

  it('should accept boundary values (page=1, perPage=1, perPage=50)', async () => {
    const errors = await validate(toDto({ page: 1, perPage: 1 }));
    expect(errors).toHaveLength(0);

    const errors2 = await validate(toDto({ perPage: 50 }));
    expect(errors2).toHaveLength(0);
  });

  // --- limit normalization ---

  it('should accept limit as numeric value', async () => {
    const dto = toDto({ limit: 10 });
    expect(dto.limit).toBe(10);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should coerce limit from string to number', async () => {
    const dto = toDto({ limit: '25' });
    expect(dto.limit).toBe(25);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should reject limit less than 1', async () => {
    const errors = await validate(toDto({ limit: 0 }));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('limit');
  });

  it('should reject limit greater than 50', async () => {
    const errors = await validate(toDto({ limit: 51 }));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('limit');
  });

  it('should reject non-numeric limit string', async () => {
    const dto = toDto({ limit: 'abc' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('limit');
  });

  it('should accept limit boundary values (1 and 50)', async () => {
    const errors1 = await validate(toDto({ limit: 1 }));
    expect(errors1).toHaveLength(0);

    const errors50 = await validate(toDto({ limit: 50 }));
    expect(errors50).toHaveLength(0);
  });

  // --- tags normalization ---

  it('should accept tags as a string', async () => {
    const dto = toDto({ tags: 'typescript,nestjs' });
    expect(dto.tags).toBe('typescript,nestjs');
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should accept single tag', async () => {
    const dto = toDto({ tags: 'react' });
    expect(dto.tags).toBe('react');
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should accept empty string tags', async () => {
    const dto = toDto({ tags: '' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should accept tags with spaces around commas', async () => {
    const dto = toDto({ tags: 'typescript, nestjs, react' });
    expect(dto.tags).toBe('typescript, nestjs, react');
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should reject non-string tags', async () => {
    const dto = toDto({ tags: 123 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('tags');
  });

  // --- search normalization ---

  it('should accept search as a string', async () => {
    const dto = toDto({ search: 'hello world' });
    expect(dto.search).toBe('hello world');
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should accept empty string search', async () => {
    const dto = toDto({ search: '' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should accept search with leading/trailing whitespace', async () => {
    const dto = toDto({ search: '  hello  ' });
    expect(dto.search).toBe('  hello  ');
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should reject non-string search', async () => {
    const dto = toDto({ search: 42 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('search');
  });

  // --- combined normalization ---

  it('should accept all fields together', async () => {
    const dto = toDto({ page: 2, perPage: 10, limit: 15, tags: 'a,b', search: 'test' });
    expect(dto.page).toBe(2);
    expect(dto.perPage).toBe(10);
    expect(dto.limit).toBe(15);
    expect(dto.tags).toBe('a,b');
    expect(dto.search).toBe('test');
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should not crash when extra unknown properties are present', async () => {
    const dto = toDto({ page: 1, unknownField: 'ignored', another: 123 } as Record<string, unknown>);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
