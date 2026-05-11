import { Test, TestingModule } from '@nestjs/testing';
import { ProfileModule } from './profile.module';

describe('ProfileModule', () => {
  it('should compile', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ProfileModule],
    }).compile();
    expect(module).toBeDefined();
  });
});
