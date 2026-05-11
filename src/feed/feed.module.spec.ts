import { Test, TestingModule } from '@nestjs/testing';
import { FeedModule } from './feed.module';
import { GetFeedUsecase, GetFeedItemUsecase } from './usecases';

describe('FeedModule', () => {
  it('should compile', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [FeedModule],
    })
      .overrideProvider(GetFeedUsecase)
      .useValue({ execute: jest.fn() })
      .overrideProvider(GetFeedItemUsecase)
      .useValue({ execute: jest.fn() })
      .compile();

    expect(module).toBeDefined();
  });
});
