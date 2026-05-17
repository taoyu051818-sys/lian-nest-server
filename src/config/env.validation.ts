import * as Joi from 'joi';

export interface EnvironmentVariables {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  LOG_LEVEL: string;
  DATABASE_URL: string;
  REDIS_URL: string;
  NODEBB_URL: string;
  NODEBB_AUTH_MODE: string;
  NODEBB_API_TOKEN: string;
  NODEBB_SESSION_COOKIE: string;
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  REFRESH_TOKEN_TTL: string;
  BCRYPT_ROUNDS: number;
  WECHAT_APP_ID: string;
  WECHAT_APP_SECRET: string;
}

export const envValidationSchema = Joi.object<EnvironmentVariables>({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'debug', 'verbose')
    .default('info'),
  DATABASE_URL: Joi.string().uri().required(),
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .default('redis://localhost:6379'),
  NODEBB_URL: Joi.string().uri().allow('').default(''),
  NODEBB_AUTH_MODE: Joi.string()
    .valid('api_token', 'session', 'none')
    .default('api_token'),
  NODEBB_API_TOKEN: Joi.string().allow('').default(''),
  NODEBB_SESSION_COOKIE: Joi.string().allow('').default(''),
  JWT_SECRET: Joi.string()
    .min(32)
    .required()
    .description('Secret key for signing JWT tokens'),
  JWT_EXPIRES_IN: Joi.string()
    .default('15m')
    .description('JWT access token TTL (e.g. 15m, 1h)'),
  REFRESH_TOKEN_TTL: Joi.string()
    .default('7d')
    .description('Refresh token TTL (e.g. 7d, 30d)'),
  BCRYPT_ROUNDS: Joi.number()
    .integer()
    .min(4)
    .max(15)
    .default(12)
    .description('bcrypt salt rounds for password hashing'),
  WECHAT_APP_ID: Joi.string()
    .allow('')
    .default('')
    .description('WeChat Official Account AppID for JS-SDK sharing'),
  WECHAT_APP_SECRET: Joi.string()
    .allow('')
    .default('')
    .description('WeChat Official Account AppSecret for JS-SDK sharing'),
});
