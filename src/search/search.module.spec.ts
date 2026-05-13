import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '../config';
import { SearchModule } from './search.module';
import { SearchUsecase } from './search.usecase';
import { SearchController } from './search.controller';

describe('SearchModule', () => {
  it('should compile', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule, SearchModule],
    }).compile();
    expect(module).toBeDefined();
  });

  it('should provide SearchUsecase', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule, SearchModule],
    }).compile();

    const usecase = module.get(SearchUsecase);
    expect(usecase).toBeDefined();
  });

  it('should provide SearchController', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule, SearchModule],
    }).compile();

    const controller = module.get(SearchController);
    expect(controller).toBeDefined();
  });
});
