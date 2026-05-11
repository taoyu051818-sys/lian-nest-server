import { Test, TestingModule } from '@nestjs/testing';
import { CategoriesModule } from './categories.module';
import { CategoriesUsecase } from './categories.usecase';

describe('CategoriesModule', () => {
  it('should compile', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [CategoriesModule],
    }).compile();
    expect(module).toBeDefined();
  });

  it('should provide CategoriesUsecase', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [CategoriesModule],
    }).compile();

    const usecase = module.get(CategoriesUsecase);
    expect(usecase).toBeDefined();
  });
});
