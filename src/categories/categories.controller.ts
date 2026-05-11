import { Controller, Get, Param } from '@nestjs/common';
import { CategoriesUsecase } from './categories.usecase';
import { CategoriesResponse, CategoryItem } from './categories.types';

@Controller('api/categories')
export class CategoriesController {
  constructor(private readonly categoriesUsecase: CategoriesUsecase) {}

  @Get()
  async list(): Promise<CategoriesResponse> {
    return this.categoriesUsecase.list();
  }

  @Get(':cid')
  async getById(@Param('cid') cid: string): Promise<CategoryItem> {
    return this.categoriesUsecase.getById(cid);
  }
}
