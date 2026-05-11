import { Injectable } from '@nestjs/common';
import {
  NodebbGroupsProvider,
  NodebbGroup,
} from '../nodebb/providers/nodebb-groups.provider';
import { BodyStatus } from '../nodebb/types';
import { GroupItem, GroupsResponse } from './groups.types';

@Injectable()
export class GroupsUsecase {
  constructor(private readonly groupsProvider: NodebbGroupsProvider) {}

  async list(): Promise<GroupsResponse> {
    let response;
    try {
      response = await this.groupsProvider.list();
    } catch {
      return { groups: [], source: 'fallback' };
    }

    if (response.status !== BodyStatus.OK || !response.data) {
      return { groups: [], source: 'fallback' };
    }

    const groups: GroupItem[] = response.data
      .filter((g: NodebbGroup) => !g.deleted && !g.system)
      .map((g: NodebbGroup) => ({
        name: g.name,
        slug: g.slug,
        description: g.description,
        memberCount: g.memberCount,
        hidden: !!g.hidden,
        deleted: !!g.deleted,
        createtime: g.createtime,
      }));

    return { groups, source: 'nodebb' };
  }
}
