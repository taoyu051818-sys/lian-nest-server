import { envValidationSchema } from './env.validation';
import { ConfigService } from './config.service';

/**
 * Helper: validate a partial env overlay against the schema.
 * Merges the overlay on top of a minimal valid base env so that
 * unrelated required fields don't cause false failures.
 */
function validateEnv(overlay: Record<string, string | undefined>) {
  const base: Record<string, string> = {
    DATABASE_URL: 'postgresql://localhost:5432/test',
    JWT_SECRET: 'test-secret-key-for-unit-tests-only-32chars!',
  };
  const merged = { ...base, ...overlay };
  // Remove keys explicitly set to undefined so Joi treats them as absent
  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined) delete merged[key];
  }
  return envValidationSchema.validate(merged, {
    allowUnknown: true,
    stripUnknown: false,
    abortEarly: false,
  });
}

// ---------------------------------------------------------------------------
// PORT coercion
// ---------------------------------------------------------------------------
describe('ConfigModule env coercion – PORT', () => {
  it('coerces numeric string to number', () => {
    const { error, value } = validateEnv({ PORT: '4000' });
    expect(error).toBeUndefined();
    expect(value.PORT).toBe(4000);
  });

  it('applies default when PORT is absent', () => {
    const { error, value } = validateEnv({});
    expect(error).toBeUndefined();
    expect(value.PORT).toBe(3000);
  });

  it('rejects non-numeric string', () => {
    const { error } = validateEnv({ PORT: 'abc' });
    expect(error).toBeDefined();
    expect(error!.details.some((d) => d.context?.key === 'PORT')).toBe(true);
  });

  it('rejects empty string', () => {
    const { error } = validateEnv({ PORT: '' });
    expect(error).toBeDefined();
  });

  it('coerces float string (Joi.number allows floats)', () => {
    const { error, value } = validateEnv({ PORT: '3000.5' });
    expect(error).toBeUndefined();
    expect(value.PORT).toBe(3000.5);
  });

  it('coerces negative number', () => {
    const { error, value } = validateEnv({ PORT: '-1' });
    // Joi.number() with no min/max allows negatives
    expect(error).toBeUndefined();
    expect(value.PORT).toBe(-1);
  });

  it('rejects hex literal string', () => {
    const { error } = validateEnv({ PORT: '0x10' });
    expect(error).toBeDefined();
  });

  it('trims whitespace-padded numeric string', () => {
    const { error, value } = validateEnv({ PORT: '  3000  ' });
    expect(error).toBeUndefined();
    expect(value.PORT).toBe(3000);
  });

  it('rejects NaN string', () => {
    const { error } = validateEnv({ PORT: 'NaN' });
    expect(error).toBeDefined();
  });

  it('rejects Infinity string', () => {
    const { error } = validateEnv({ PORT: 'Infinity' });
    expect(error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// NODE_ENV coercion
// ---------------------------------------------------------------------------
describe('ConfigModule env coercion – NODE_ENV', () => {
  it('accepts valid development', () => {
    const { error, value } = validateEnv({ NODE_ENV: 'development' });
    expect(error).toBeUndefined();
    expect(value.NODE_ENV).toBe('development');
  });

  it('accepts valid production', () => {
    const { error, value } = validateEnv({ NODE_ENV: 'production' });
    expect(error).toBeUndefined();
    expect(value.NODE_ENV).toBe('production');
  });

  it('accepts valid test', () => {
    const { error, value } = validateEnv({ NODE_ENV: 'test' });
    expect(error).toBeUndefined();
    expect(value.NODE_ENV).toBe('test');
  });

  it('defaults to development when absent', () => {
    const { error, value } = validateEnv({});
    expect(error).toBeUndefined();
    expect(value.NODE_ENV).toBe('development');
  });

  it('rejects invalid enum value', () => {
    const { error } = validateEnv({ NODE_ENV: 'staging' });
    expect(error).toBeDefined();
    expect(error!.details.some((d) => d.context?.key === 'NODE_ENV')).toBe(true);
  });

  it('rejects empty string', () => {
    const { error } = validateEnv({ NODE_ENV: '' });
    expect(error).toBeDefined();
  });

  it('rejects numeric input', () => {
    const { error } = validateEnv({ NODE_ENV: '123' });
    expect(error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// LOG_LEVEL coercion
// ---------------------------------------------------------------------------
describe('ConfigModule env coercion – LOG_LEVEL', () => {
  it.each(['error', 'warn', 'info', 'debug', 'verbose'])(
    'accepts valid level "%s"',
    (level) => {
      const { error, value } = validateEnv({ LOG_LEVEL: level });
      expect(error).toBeUndefined();
      expect(value.LOG_LEVEL).toBe(level);
    },
  );

  it('defaults to info when absent', () => {
    const { error, value } = validateEnv({});
    expect(error).toBeUndefined();
    expect(value.LOG_LEVEL).toBe('info');
  });

  it('rejects invalid level', () => {
    const { error } = validateEnv({ LOG_LEVEL: 'trace' });
    expect(error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// DATABASE_URL coercion
// ---------------------------------------------------------------------------
describe('ConfigModule env coercion – DATABASE_URL', () => {
  it('accepts valid postgres URI', () => {
    const { error, value } = validateEnv({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    });
    expect(error).toBeUndefined();
    expect(value.DATABASE_URL).toBe('postgresql://user:pass@localhost:5432/db');
  });

  it('fails when DATABASE_URL is missing', () => {
    const base = {};
    const result = envValidationSchema.validate(base, {
      allowUnknown: true,
      stripUnknown: false,
      abortEarly: false,
    });
    expect(result.error).toBeDefined();
    expect(
      result.error!.details.some((d) => d.context?.key === 'DATABASE_URL'),
    ).toBe(true);
  });

  it('rejects invalid URI format', () => {
    const { error } = validateEnv({ DATABASE_URL: 'not-a-uri' });
    expect(error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// REDIS_URL coercion
// ---------------------------------------------------------------------------
describe('ConfigModule env coercion – REDIS_URL', () => {
  it('accepts redis:// scheme', () => {
    const { error, value } = validateEnv({ REDIS_URL: 'redis://localhost:6379' });
    expect(error).toBeUndefined();
    expect(value.REDIS_URL).toBe('redis://localhost:6379');
  });

  it('accepts rediss:// scheme (TLS)', () => {
    const { error, value } = validateEnv({
      REDIS_URL: 'rediss://localhost:6380',
    });
    expect(error).toBeUndefined();
    expect(value.REDIS_URL).toBe('rediss://localhost:6380');
  });

  it('rejects http:// scheme', () => {
    const { error } = validateEnv({ REDIS_URL: 'http://localhost:6379' });
    expect(error).toBeDefined();
  });

  it('defaults when absent', () => {
    const { error, value } = validateEnv({});
    expect(error).toBeUndefined();
    expect(value.REDIS_URL).toBe('redis://localhost:6379');
  });
});

// ---------------------------------------------------------------------------
// NODEBB field coercion
// ---------------------------------------------------------------------------
describe('ConfigModule env coercion – NODEBB fields', () => {
  it('NODEBB_URL accepts valid URI', () => {
    const { error, value } = validateEnv({
      NODEBB_URL: 'https://forum.example.com',
    });
    expect(error).toBeUndefined();
    expect(value.NODEBB_URL).toBe('https://forum.example.com');
  });

  it('NODEBB_URL accepts empty string (allow empty)', () => {
    const { error, value } = validateEnv({ NODEBB_URL: '' });
    expect(error).toBeUndefined();
    expect(value.NODEBB_URL).toBe('');
  });

  it('NODEBB_URL defaults to empty string', () => {
    const { error, value } = validateEnv({});
    expect(error).toBeUndefined();
    expect(value.NODEBB_URL).toBe('');
  });

  it('NODEBB_AUTH_MODE accepts valid modes', () => {
    for (const mode of ['api_token', 'session', 'none']) {
      const { error } = validateEnv({ NODEBB_AUTH_MODE: mode });
      expect(error).toBeUndefined();
    }
  });

  it('NODEBB_AUTH_MODE rejects invalid mode', () => {
    const { error } = validateEnv({ NODEBB_AUTH_MODE: 'oauth' });
    expect(error).toBeDefined();
  });

  it('NODEBB_AUTH_MODE defaults to api_token', () => {
    const { error, value } = validateEnv({});
    expect(error).toBeUndefined();
    expect(value.NODEBB_AUTH_MODE).toBe('api_token');
  });

  it('NODEBB_API_TOKEN accepts empty string', () => {
    const { error, value } = validateEnv({ NODEBB_API_TOKEN: '' });
    expect(error).toBeUndefined();
    expect(value.NODEBB_API_TOKEN).toBe('');
  });

  it('NODEBB_SESSION_COOKIE accepts empty string', () => {
    const { error, value } = validateEnv({ NODEBB_SESSION_COOKIE: '' });
    expect(error).toBeUndefined();
    expect(value.NODEBB_SESSION_COOKIE).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Error message aggregation
// ---------------------------------------------------------------------------
describe('ConfigModule env coercion – error aggregation', () => {
  it('collects multiple validation errors in a single pass', () => {
    const result = envValidationSchema.validate(
      { PORT: 'abc', NODE_ENV: 'staging', LOG_LEVEL: 'trace' },
      { allowUnknown: true, stripUnknown: false, abortEarly: false },
    );
    expect(result.error).toBeDefined();
    const keys = result.error!.details.map((d) => d.context?.key);
    // All three invalid fields should be reported
    expect(keys).toContain('PORT');
    expect(keys).toContain('NODE_ENV');
    expect(keys).toContain('LOG_LEVEL');
  });
});

// ---------------------------------------------------------------------------
// ConfigService integration
// ---------------------------------------------------------------------------
describe('ConfigService – env coercion integration', () => {
  const savedEnv: Record<string, string | undefined> = {};

  function setEnv(vars: Record<string, string | undefined>) {
    for (const [k, v] of Object.entries(vars)) {
      savedEnv[k] = process.env[k];
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }

  function restoreEnv() {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }

  afterEach(() => restoreEnv());

  it('constructs successfully with valid env', () => {
    setEnv({
      DATABASE_URL: 'postgresql://localhost:5432/test',
      PORT: '4000',
      NODE_ENV: 'production',
    });
    const svc = new ConfigService();
    expect(svc.port).toBe(4000);
    expect(svc.nodeEnv).toBe('production');
    expect(svc.isProduction).toBe(true);
    expect(svc.isDevelopment).toBe(false);
  });

  it('applies defaults for absent optional fields', () => {
    setEnv({
      DATABASE_URL: 'postgresql://localhost:5432/test',
      NODE_ENV: undefined, // clear Jest-injected NODE_ENV
      LOG_LEVEL: undefined,
      REDIS_URL: undefined,
    });
    const svc = new ConfigService();
    expect(svc.port).toBe(3000);
    expect(svc.nodeEnv).toBe('development');
    expect(svc.logLevel).toBe('info');
    expect(svc.redisUrl).toBe('redis://localhost:6379');
    expect(svc.isDevelopment).toBe(true);
  });

  it('throws on invalid PORT', () => {
    setEnv({
      DATABASE_URL: 'postgresql://localhost:5432/test',
      PORT: 'not-a-port',
    });
    expect(() => new ConfigService()).toThrow(/Environment validation failed/);
  });

  it('exposes nodebbConfig with defaults', () => {
    setEnv({
      DATABASE_URL: 'postgresql://localhost:5432/test',
    });
    const svc = new ConfigService();
    expect(svc.nodebbConfig).toEqual({
      url: '',
      authMode: 'api_token',
      apiToken: '',
      sessionCookie: '',
    });
  });

  it('throws aggregated error for multiple invalid fields', () => {
    setEnv({
      DATABASE_URL: 'postgresql://localhost:5432/test',
      PORT: 'abc',
      NODE_ENV: 'invalid',
    });
    expect(() => new ConfigService()).toThrow(/Environment validation failed/);
    try {
      new ConfigService();
    } catch (e: any) {
      // Error message should mention both PORT and NODE_ENV issues
      expect(e.message).toMatch(/PORT/);
      expect(e.message).toMatch(/NODE_ENV/);
    }
  });
});
