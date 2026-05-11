import * as Joi from 'joi';

export interface EnvironmentVariables {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  LOG_LEVEL: string;
  NODEBB_URL: string;
  NODEBB_AUTH_MODE: string;
  NODEBB_API_TOKEN: string;
  NODEBB_SESSION_COOKIE: string;
}

export const envValidationSchema = Joi.object<EnvironmentVariables>({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'debug', 'verbose')
    .default('info'),
  NODEBB_URL: Joi.string().uri().allow('').default(''),
  NODEBB_AUTH_MODE: Joi.string()
    .valid('api_token', 'session', 'none')
    .default('api_token'),
  NODEBB_API_TOKEN: Joi.string().allow('').default(''),
  NODEBB_SESSION_COOKIE: Joi.string().allow('').default(''),
});
