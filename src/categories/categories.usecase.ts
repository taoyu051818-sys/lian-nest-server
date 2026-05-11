import { Injectable, NotFoundException } from '@nestjs/common';
import { NodebbCategoriesProvider } from '../nodebb/providers/nodebb-categories.provider';
import { BodyStatus } from '../nodebb/types';
import { CategoryItem, CategoriesResponse } from './categories.types';

@Injectable()
export class CategoriesUsecase {
  constructor(
    private readonly categoriesProvider: NodebbCategoriesProvider,
  ) {}

  async list(): Promise<CategoriesResponse> {
    const response = await this.categoriesProvider.list();

    if (response.status !== BodyStatus.OK || !response.data) {
      return { categories: [], source: 'fallback' };
    }

    const categories: CategoryItem[] = response.data
      .filter((cat) => !cat.disabled)
      .map((cat) => ({
        cid: cat.cid,
        name: cat.name,
        slug: cat.slug,
        description: cat.description,
        icon: cat.icon,
        color: cat.color,
        bgColor: cat.bgColor,
        topicCount: cat.topic_count,
        postCount: cat.post_count,
      }));

    return { categories, source: 'nodebb' };
  }

  async getById(cidParam: string): Promise<CategoryItem> {
    const cid = Number(cidParam);
    if (!Number.isFinite(cid) || cid < 1) {
      throw new NotFoundException(`Category ${cidParam} not found`);
    }

    const response = await this.categoriesProvider.getById(cid);

    if (response.status === BodyStatus.NOT_FOUND || !response.data) {
      throw new NotFoundException(`Category ${cid} not found`);
    }

    const cat = response.data;
    return {
      cid: cat.cid,
      name: cat.name,
      slug: cat.slug,
      description: cat.description,
      icon: cat.icon,
      color: cat.color,
      bgColor: cat.bgColor,
      topicCount: cat.topic_count,
      postCount: cat.post_count,
    };
  }
}
