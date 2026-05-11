import { Test, TestingModule } from '@nestjs/testing';
import { TagsController } from './tags.controller';
import { TagsUsecase } from './tags.usecase';
import { NodebbTagsProvider } from '../nodebb/providers/nodebb-tags.provider';
import { BodyStatus } from '../nodebb/types';

describe('TagsController – unicode tag query', () => {
  let controller: TagsController;
  let usecase: TagsUsecase;

  const mockProvider = {
    list: jest.fn(),
    listTopics: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TagsController],
      providers: [
        TagsUsecase,
        { provide: NodebbTagsProvider, useValue: mockProvider },
      ],
    }).compile();

    controller = module.get<TagsController>(TagsController);
    usecase = module.get<TagsUsecase>(TagsUsecase);
    jest.clearAllMocks();
  });

  const unicodeTags = [
    { label: 'CJK characters', tag: '技术' },
    { label: 'Japanese hiragana', tag: 'テスト' },
    { label: 'Korean hangul', tag: '태그' },
    { label: 'emoji', tag: '🔥react' },
    { label: 'accented latin', tag: 'café' },
    { label: 'mixed unicode and ASCII', tag: 'node.js入门' },
    { label: 'Arabic script', tag: 'برمجة' },
    { label: 'Devanagari', tag: 'प्रोग्रामिंग' },
    { label: 'Thai', tag: 'การเขียนโค้ด' },
    { label: 'Cyrillic', tag: 'программирование' },
    { label: 'multi-byte emoji combo', tag: '👨‍💻👩‍💻' },
    { label: 'zero-width joiner sequence', tag: '🏳️‍🌈' },
    { label: 'unicode with spaces', tag: '机器 学习' },
  ];

  describe.each(unicodeTags)('$label: "$tag"', ({ tag }) => {
    it('should pass unicode tag through to usecase unchanged', async () => {
      const mockResponse = {
        topics: [],
        source: 'nodebb' as const,
        totalCount: 0,
        page: 1,
        perPage: 20,
      };
      const spy = jest
        .spyOn(usecase, 'listTopics')
        .mockResolvedValue(mockResponse);

      await controller.listTopics(tag, {});

      expect(spy).toHaveBeenCalledWith(tag, {});
    });

    it('should return valid envelope for unicode tag', async () => {
      const mockResponse = {
        topics: [
          {
            tid: 1,
            uid: 2,
            cid: 3,
            title: `Topic for ${tag}`,
            slug: `topic-${tag}`,
            mainPid: 10,
            postcount: 5,
            viewcount: 100,
            timestamp: 1700000000,
          },
        ],
        source: 'nodebb' as const,
        totalCount: 1,
        page: 1,
        perPage: 20,
      };
      jest.spyOn(usecase, 'listTopics').mockResolvedValue(mockResponse);

      const result = await controller.listTopics(tag, {});

      expect(result.source).toBe('nodebb');
      expect(result.topics).toHaveLength(1);
      expect(result.topics[0].title).toContain(tag);
      expect(result.totalCount).toBe(1);
      expect(result.page).toBe(1);
      expect(result.perPage).toBe(20);
    });
  });

  describe('TagsUsecase – unicode passthrough to provider', () => {
    let provider: jest.Mocked<NodebbTagsProvider>;

    beforeEach(() => {
      provider = mockProvider as unknown as jest.Mocked<NodebbTagsProvider>;
    });

    it.each(unicodeTags)(
      'should pass "$tag" ($label) directly to provider without encoding',
      async ({ tag }) => {
        provider.listTopics.mockResolvedValue({
          status: BodyStatus.OK,
          statusCode: 200,
          data: { topics: [] },
          error: null,
        });

        await usecase.listTopics(tag, {});

        expect(provider.listTopics).toHaveBeenCalledWith(tag);
      },
    );

    it('should handle unicode tag with provider error gracefully', async () => {
      provider.listTopics.mockResolvedValue({
        status: BodyStatus.ERROR,
        statusCode: 500,
        data: null,
        error: 'upstream failure',
      });

      const result = await usecase.listTopics('技术', {});

      expect(result.source).toBe('fallback');
      expect(result.topics).toEqual([]);
      expect(result.totalCount).toBe(0);
      expect(result.page).toBe(1);
      expect(result.perPage).toBe(20);
    });

    it('should handle unicode tag with pagination', async () => {
      const topics = Array.from({ length: 10 }, (_, i) => ({
        tid: i + 1,
        uid: 2,
        cid: 3,
        title: `Topic ${i + 1}`,
        slug: `topic-${i + 1}`,
        mainPid: (i + 1) * 10,
        postcount: 5,
        viewcount: 100,
        timestamp: 1700000000 + i,
      }));
      provider.listTopics.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: { topics },
        error: null,
      });

      const result = await usecase.listTopics('🔥react', { page: 2, perPage: 3 });

      expect(result.page).toBe(2);
      expect(result.perPage).toBe(3);
      expect(result.totalCount).toBe(10);
      expect(result.topics).toHaveLength(3);
      expect(result.topics[0].tid).toBe(4);
    });

    it('should handle unicode tag with zero-width joiner emoji', async () => {
      provider.listTopics.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: { topics: [] },
        error: null,
      });

      await usecase.listTopics('🏳️‍🌈', {});

      expect(provider.listTopics).toHaveBeenCalledWith('🏳️‍🌈');
    });

    it('should preserve unicode title and slug in response mapping', async () => {
      provider.listTopics.mockResolvedValue({
        status: BodyStatus.OK,
        statusCode: 200,
        data: {
          topics: [
            {
              tid: 1,
              uid: 2,
              cid: 3,
              title: '编程入门教程',
              slug: '编程入门教程',
              mainPid: 10,
              postcount: 3,
              viewcount: 50,
              timestamp: 1700000000,
            },
          ],
        },
        error: null,
      });

      const result = await usecase.listTopics('编程', {});

      expect(result.topics[0].title).toBe('编程入门教程');
      expect(result.topics[0].slug).toBe('编程入门教程');
    });
  });
});
