import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '../config';
import { ProfileModule } from './profile.module';
import { ProfileUsecase } from './profile.usecase';

describe('ProfileModule', () => {
  it('should compile', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule, ProfileModule],
    }).compile();
    expect(module).toBeDefined();
  });

  it('should provide ProfileUsecase', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule, ProfileModule],
    }).compile();

    const usecase = module.get(ProfileUsecase);
    expect(usecase).toBeDefined();
  });
});
