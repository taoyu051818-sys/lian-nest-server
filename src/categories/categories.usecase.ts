import { Injectable } from '@nestjs/common';
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
}
