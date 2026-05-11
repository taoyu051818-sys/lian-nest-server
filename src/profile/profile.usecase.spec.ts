import { Test, TestingModule } from '@nestjs/testing';
import { ProfileUsecase } from './profile.usecase';

describe('ProfileUsecase', () => {
  let usecase: ProfileUsecase;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProfileUsecase],
    }).compile();

    usecase = module.get<ProfileUsecase>(ProfileUsecase);
  });

  it('should be defined', () => {
    expect(usecase).toBeDefined();
  });

  describe('getPublicProfile', () => {
    it('should throw not-implemented error with uid', async () => {
      await expect(usecase.getPublicProfile('42')).rejects.toThrow(
        'getPublicProfile(42) not implemented',
      );
    });
  });

  describe('getSaved', () => {
    it('should throw not-implemented error with uid', async () => {
      await expect(usecase.getSaved('42')).rejects.toThrow(
        'getSaved(42) not implemented',
      );
    });
  });

  describe('getLiked', () => {
    it('should throw not-implemented error with uid', async () => {
      await expect(usecase.getLiked('42')).rejects.toThrow(
        'getLiked(42) not implemented',
      );
    });
  });

  describe('getHistory', () => {
    it('should throw not-implemented error with uid', async () => {
      await expect(usecase.getHistory('42')).rejects.toThrow(
        'getHistory(42) not implemented',
      );
    });
  });
});
