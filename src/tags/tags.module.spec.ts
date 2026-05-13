import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '../config';
import { TagsModule } from './tags.module';
import { TagsUsecase } from './tags.usecase';

describe('TagsModule', () => {
  it('should compile', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule, TagsModule],
    }).compile();
    expect(module).toBeDefined();
  });

  it('should provide TagsUsecase', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule, TagsModule],
    }).compile();

    const usecase = module.get(TagsUsecase);
    expect(usecase).toBeDefined();
  });
});
