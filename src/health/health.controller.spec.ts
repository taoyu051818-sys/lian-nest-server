import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should return healthy status', () => {
    const result = controller.check();
    expect(result.ok).toBe(true);
    expect(result.status).toBe('healthy');
    expect(result.timestamp).toBeDefined();
    expect(typeof result.uptime).toBe('number');
  });
});
