import { GlobalExceptionFilter, ErrorEnvelope } from './http-exception.filter';
import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';

/**
 * HttpExceptionFilter edge-case regression coverage.
 *
 * Supplements http-exception.filter.spec.ts with focused tests on
 * non-Error throwables, statusToCode mapping completeness, unmapped
 * status fallback, object response field extraction, and ErrorEnvelope
 * shape contract.
 */

function makeHost(url = '/edge-test') {
  const mockResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const mockRequest = { url };
  const host = {
    switchToHttp: () => ({
      getResponse: () => mockResponse,
      getRequest: () => mockRequest,
    }),
  } as unknown as ArgumentsHost;
  return { host, mockResponse, mockRequest };
}

function callFilter(exception: unknown, url = '/edge-test') {
  const filter = new GlobalExceptionFilter();
  const { host, mockResponse } = makeHost(url);
  filter.catch(exception, host);
  const envelope: ErrorEnvelope = mockResponse.json.mock.calls[0][0];
  return { envelope, mockResponse };
}

describe('GlobalExceptionFilter edge coverage', () => {
  describe('non-Error throwables (fallback branch)', () => {
    it('handles thrown string as 500 Internal server error', () => {
      const { envelope } = callFilter('raw string exception');
      expect(envelope.ok).toBe(false);
      expect(envelope.error.statusCode).toBe(500);
      expect(envelope.error.message).toBe('Internal server error');
      expect(envelope.error.code).toBe('INTERNAL_ERROR');
    });

    it('handles thrown number as 500 Internal server error', () => {
      const { envelope } = callFilter(42);
      expect(envelope.ok).toBe(false);
      expect(envelope.error.statusCode).toBe(500);
      expect(envelope.error.message).toBe('Internal server error');
      expect(envelope.error.code).toBe('INTERNAL_ERROR');
    });

    it('handles thrown null as 500 Internal server error', () => {
      const { envelope } = callFilter(null);
      expect(envelope.ok).toBe(false);
      expect(envelope.error.statusCode).toBe(500);
      expect(envelope.error.message).toBe('Internal server error');
      expect(envelope.error.code).toBe('INTERNAL_ERROR');
    });

    it('handles thrown undefined as 500 Internal server error', () => {
      const { envelope } = callFilter(undefined);
      expect(envelope.ok).toBe(false);
      expect(envelope.error.statusCode).toBe(500);
      expect(envelope.error.message).toBe('Internal server error');
      expect(envelope.error.code).toBe('INTERNAL_ERROR');
    });

    it('handles thrown plain object as 500 Internal server error', () => {
      const { envelope } = callFilter({ foo: 'bar' });
      expect(envelope.ok).toBe(false);
      expect(envelope.error.statusCode).toBe(500);
      expect(envelope.error.message).toBe('Internal server error');
      expect(envelope.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('statusToCode mapping completeness', () => {
    const expectedMappings: [number, string][] = [
      [400, 'BAD_REQUEST'],
      [401, 'UNAUTHORIZED'],
      [403, 'FORBIDDEN'],
      [404, 'NOT_FOUND'],
      [405, 'METHOD_NOT_ALLOWED'],
      [408, 'REQUEST_TIMEOUT'],
      [409, 'CONFLICT'],
      [410, 'GONE'],
      [422, 'UNPROCESSABLE_ENTITY'],
      [429, 'TOO_MANY_REQUESTS'],
      [500, 'INTERNAL_ERROR'],
      [502, 'BAD_GATEWAY'],
      [503, 'SERVICE_UNAVAILABLE'],
      [504, 'GATEWAY_TIMEOUT'],
    ];

    it.each(expectedMappings)(
      'maps status %i to code %s',
      (status, expectedCode) => {
        const { envelope } = callFilter(
          new HttpException('msg', status),
        );
        expect(envelope.error.statusCode).toBe(status);
        expect(envelope.error.code).toBe(expectedCode);
      },
    );
  });

  describe('unmapped status code fallback', () => {
    it('falls back to ERROR code for unmapped 418 status', () => {
      const { envelope } = callFilter(
        new HttpException('teapot', 418),
      );
      expect(envelope.error.statusCode).toBe(418);
      expect(envelope.error.code).toBe('ERROR');
      expect(envelope.error.message).toBe('teapot');
    });

    it('falls back to ERROR code for unmapped 451 status', () => {
      const { envelope } = callFilter(
        new HttpException('unavailable', 451),
      );
      expect(envelope.error.statusCode).toBe(451);
      expect(envelope.error.code).toBe('ERROR');
    });
  });

  describe('HttpException object response field extraction', () => {
    it('extracts code from error field in object response', () => {
      const { envelope } = callFilter(
        new HttpException(
          { message: 'Validation failed', error: 'Bad Request' },
          HttpStatus.BAD_REQUEST,
        ),
      );
      expect(envelope.error.code).toBe('Bad Request');
      expect(envelope.error.message).toBe('Validation failed');
    });

    it('falls back to statusToCode when error field is absent', () => {
      const { envelope } = callFilter(
        new HttpException(
          { message: 'Something wrong' },
          HttpStatus.NOT_FOUND,
        ),
      );
      expect(envelope.error.code).toBe('NOT_FOUND');
      expect(envelope.error.message).toBe('Something wrong');
    });

    it('falls back to default message when message field is absent', () => {
      const { envelope } = callFilter(
        new HttpException(
          { error: 'Bad Request' },
          HttpStatus.BAD_REQUEST,
        ),
      );
      expect(envelope.error.code).toBe('Bad Request');
      expect(envelope.error.message).toBe('Internal server error');
    });

    it('handles empty object response', () => {
      const { envelope } = callFilter(
        new HttpException({}, HttpStatus.UNPROCESSABLE_ENTITY),
      );
      expect(envelope.error.statusCode).toBe(422);
      expect(envelope.error.code).toBe('UNPROCESSABLE_ENTITY');
      expect(envelope.error.message).toBe('Internal server error');
    });
  });

  describe('HttpException string response', () => {
    it('uses string response as message', () => {
      const { envelope } = callFilter(
        new HttpException('Forbidden area', HttpStatus.FORBIDDEN),
      );
      expect(envelope.error.statusCode).toBe(403);
      expect(envelope.error.message).toBe('Forbidden area');
      expect(envelope.error.code).toBe('FORBIDDEN');
    });

    it('handles empty string response', () => {
      const { envelope } = callFilter(
        new HttpException('', HttpStatus.NOT_FOUND),
      );
      expect(envelope.error.statusCode).toBe(404);
      expect(envelope.error.message).toBe('');
      expect(envelope.error.code).toBe('NOT_FOUND');
    });
  });

  describe('ErrorEnvelope shape contract', () => {
    it('always produces a complete ErrorEnvelope shape', () => {
      const { envelope } = callFilter(
        new HttpException('test', HttpStatus.BAD_REQUEST),
      );

      expect(envelope).toHaveProperty('ok');
      expect(envelope).toHaveProperty('error');
      expect(envelope.ok).toBe(false);

      expect(envelope.error).toHaveProperty('code');
      expect(envelope.error).toHaveProperty('message');
      expect(envelope.error).toHaveProperty('statusCode');
      expect(envelope.error).toHaveProperty('timestamp');
      expect(envelope.error).toHaveProperty('path');

      expect(typeof envelope.error.code).toBe('string');
      expect(typeof envelope.error.message).toBe('string');
      expect(typeof envelope.error.statusCode).toBe('number');
      expect(typeof envelope.error.timestamp).toBe('string');
      expect(typeof envelope.error.path).toBe('string');
    });

    it('produces valid ISO timestamp', () => {
      const { envelope } = callFilter(new Error('x'));
      const parsed = new Date(envelope.error.timestamp);
      expect(parsed.toISOString()).toBe(envelope.error.timestamp);
    });

    it('reflects request URL in path', () => {
      const filter = new GlobalExceptionFilter();
      const { host } = makeHost('/custom/path');
      filter.catch(new Error('x'), host);
      // re-extract from the same mock
      const mockResp = host.switchToHttp().getResponse() as any;
      const envelope: ErrorEnvelope = mockResp.json.mock.calls[0][0];
      expect(envelope.error.path).toBe('/custom/path');
    });
  });

  describe('code override logic', () => {
    it('uses INTERNAL_ERROR from statusToCode when code is initially empty string', () => {
      // HttpException with object response where error field is empty string
      const { envelope } = callFilter(
        new HttpException(
          { message: 'test', error: '' },
          HttpStatus.INTERNAL_SERVER_ERROR,
        ),
      );
      // Empty string is falsy, so the fallback code = statusToCode(500)
      expect(envelope.error.code).toBe('INTERNAL_ERROR');
    });

    it('preserves explicit code when not INTERNAL_ERROR', () => {
      const { envelope } = callFilter(
        new HttpException(
          { message: 'test', error: 'CUSTOM_CODE' },
          HttpStatus.BAD_REQUEST,
        ),
      );
      expect(envelope.error.code).toBe('CUSTOM_CODE');
    });
  });
});
