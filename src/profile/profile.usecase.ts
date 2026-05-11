import { Injectable } from '@nestjs/common';
import {
  PublicProfile,
  SavedItem,
  LikedItem,
  HistoryItem,
  ProfileCollection,
} from './types';

@Injectable()
export class ProfileUsecase {
  async getPublicProfile(uid: string): Promise<PublicProfile> {
    throw new Error(`getPublicProfile(${uid}) not implemented — awaiting NodeBB collection wiring`);
  }

  async getSaved(uid: string): Promise<ProfileCollection<SavedItem>> {
    throw new Error(`getSaved(${uid}) not implemented — awaiting NodeBB collection wiring`);
  }

  async getLiked(uid: string): Promise<ProfileCollection<LikedItem>> {
    throw new Error(`getLiked(${uid}) not implemented — awaiting NodeBB collection wiring`);
  }

  async getHistory(uid: string): Promise<ProfileCollection<HistoryItem>> {
    throw new Error(`getHistory(${uid}) not implemented — awaiting NodeBB collection wiring`);
  }
}
