import { Test, TestingModule } from '@nestjs/testing';
import { TagsModule } from './tags.module';
import { TagsUsecase } from './tags.usecase';

describe('TagsModule', () => {
  it('should compile', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [TagsModule],
    }).compile();
    expect(module).toBeDefined();
  });

  it('should provide TagsUsecase', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [TagsModule],
    }).compile();

    const usecase = module.get(TagsUsecase);
    expect(usecase).toBeDefined();
  });
});
