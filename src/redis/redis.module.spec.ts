import { Test, TestingModule } from '@nestjs/testing';
import { RedisModule } from './redis.module';
import { RedisService } from './redis.service';
import { REDIS_CLIENT } from './redis.constants';
import { ConfigModule } from '../config/config.module';
import { ConfigService } from '../config/config.service';

jest.mock('ioredis', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      quit: jest.fn().mockResolvedValue('OK'),
      status: 'ready',
    })),
  };
});

describe('RedisModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [ConfigModule, RedisModule],
    })
      .overrideProvider(ConfigService)
      .useValue({ redisUrl: 'redis://localhost:6379' })
      .compile();
  });

  afterEach(async () => {
    await module.close();
  });

  it('should construct the module', () => {
    expect(module).toBeDefined();
  });

  it('should provide RedisService', () => {
    const service = module.get<RedisService>(RedisService);
    expect(service).toBeDefined();
    expect(service.getClient).toBeDefined();
  });

  it('should provide REDIS_CLIENT token', () => {
    const client = module.get(REDIS_CLIENT);
    expect(client).toBeDefined();
  });

  it('REDIS_CLIENT should be the same instance as RedisService.getClient()', () => {
    const service = module.get<RedisService>(RedisService);
    const client = module.get(REDIS_CLIENT);
    expect(client).toBe(service.getClient());
  });
});
