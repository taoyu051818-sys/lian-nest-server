import { Controller, Get, Query } from '@nestjs/common';
import { SearchUsecase } from './search.usecase';
import { SearchResponse } from './types';

@Controller('api/search')
export class SearchController {
  constructor(private readonly searchUsecase: SearchUsecase) {}

  @Get()
  async search(
    @Query('term') term: string,
    @Query('page') page?: string,
  ): Promise<SearchResponse> {
    return this.searchUsecase.search(term, page);
  }
}
