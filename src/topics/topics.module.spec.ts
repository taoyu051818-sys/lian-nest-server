import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '../config';
import { TopicsModule } from './topics.module';
import { TopicsUsecase } from './topics.usecase';

describe('TopicsModule', () => {
  it('should compile', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule, TopicsModule],
    }).compile();
    expect(module).toBeDefined();
  });

  it('should provide TopicsUsecase', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule, TopicsModule],
    }).compile();

    const usecase = module.get(TopicsUsecase);
    expect(usecase).toBeDefined();
  });
});
