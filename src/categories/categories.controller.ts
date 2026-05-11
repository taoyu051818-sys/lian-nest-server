import { Controller, Get } from '@nestjs/common';
import { CategoriesUsecase } from './categories.usecase';
import { CategoriesResponse } from './categories.types';

@Controller('api/categories')
export class CategoriesController {
  constructor(private readonly categoriesUsecase: CategoriesUsecase) {}

  @Get()
  async list(): Promise<CategoriesResponse> {
    return this.categoriesUsecase.list();
  }
}
