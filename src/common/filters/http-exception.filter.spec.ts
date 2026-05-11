import { GlobalExceptionFilter } from './http-exception.filter';
import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let mockResponse: any;
  let mockRequest: any;
  let mockHost: ArgumentsHost;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockRequest = { url: '/test' };
    mockHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    } as any;
  });

  it('should format HttpException into error envelope', () => {
    filter.catch(new HttpException('Not found', HttpStatus.NOT_FOUND), mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(404);
    const envelope = mockResponse.json.mock.calls[0][0];
    expect(envelope.ok).toBe(false);
    expect(envelope.error.statusCode).toBe(404);
    expect(envelope.error.path).toBe('/test');
    expect(envelope.error.timestamp).toBeDefined();
  });

  it('should handle generic errors as 500', () => {
    filter.catch(new Error('boom'), mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(500);
    const envelope = mockResponse.json.mock.calls[0][0];
    expect(envelope.ok).toBe(false);
    expect(envelope.error.statusCode).toBe(500);
    expect(envelope.error.message).toBe('boom');
  });

  it('should handle HttpException with object response', () => {
    filter.catch(
      new HttpException(
        { message: 'Validation failed', error: 'Bad Request' },
        HttpStatus.BAD_REQUEST,
      ),
      mockHost,
    );

    const envelope = mockResponse.json.mock.calls[0][0];
    expect(envelope.ok).toBe(false);
    expect(envelope.error.statusCode).toBe(400);
  });
});
