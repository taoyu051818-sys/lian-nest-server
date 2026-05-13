import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '../config';
import { UsersModule } from './users.module';
import { UsersUsecase } from './users.usecase';

describe('UsersModule', () => {
  it('should compile', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule, UsersModule],
    }).compile();
    expect(module).toBeDefined();
  });

  it('should provide UsersUsecase', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule, UsersModule],
    }).compile();

    const usecase = module.get(UsersUsecase);
    expect(usecase).toBeDefined();
  });
});
