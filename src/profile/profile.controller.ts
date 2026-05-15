import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, Public, CurrentUser } from '../auth';
import { ProfileUsecase } from './profile.usecase';
import {
  PublicProfile,
  SavedItem,
  LikedItem,
  HistoryItem,
  ProfileCollection,
  CollectionQuery,
} from './types';

@Controller('api/profile')
@UseGuards(JwtAuthGuard)
export class ProfileController {
  constructor(private readonly profileUsecase: ProfileUsecase) {}

  @Public()
  @Get(':uid')
  async getPublicProfile(@Param('uid') uid: string): Promise<PublicProfile> {
    return this.profileUsecase.getPublicProfile(uid);
  }

  @Get(':uid/saved')
  async getSaved(
    @Param('uid') uid: string,
    @Query() query: CollectionQuery,
    @CurrentUser('sub') currentUserId: number,
  ): Promise<ProfileCollection<SavedItem>> {
    return this.profileUsecase.getSaved(uid, query);
  }

  @Get(':uid/liked')
  async getLiked(
    @Param('uid') uid: string,
    @Query() query: CollectionQuery,
    @CurrentUser('sub') currentUserId: number,
  ): Promise<ProfileCollection<LikedItem>> {
    return this.profileUsecase.getLiked(uid, query);
  }

  @Get(':uid/history')
  async getHistory(
    @Param('uid') uid: string,
    @Query() query: CollectionQuery,
    @CurrentUser('sub') currentUserId: number,
  ): Promise<ProfileCollection<HistoryItem>> {
    return this.profileUsecase.getHistory(uid, query);
  }
}
