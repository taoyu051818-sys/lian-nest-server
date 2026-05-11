import { Test, TestingModule } from '@nestjs/testing';
import { FeedModule } from './feed.module';

describe('FeedModule', () => {
  it('should compile', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [FeedModule],
    }).compile();

    expect(module).toBeDefined();
  });
});
