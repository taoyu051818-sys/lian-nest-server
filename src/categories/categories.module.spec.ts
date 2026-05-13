import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '../config';
import { CategoriesModule } from './categories.module';
import { CategoriesUsecase } from './categories.usecase';

describe('CategoriesModule', () => {
  it('should compile', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule, CategoriesModule],
    }).compile();
    expect(module).toBeDefined();
  });

  it('should provide CategoriesUsecase', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule, CategoriesModule],
    }).compile();

    const usecase = module.get(CategoriesUsecase);
    expect(usecase).toBeDefined();
  });
});
