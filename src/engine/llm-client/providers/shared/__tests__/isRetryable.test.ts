import { describe, it, expect } from 'vitest';
import { isRetryable } from '../isRetryable';
import {
  TransportError,
  ConnectTimeoutError,
  APIError,
  EmptyResponseError,
  OutputTooLongError,
  MalformedToolCallError,
} from '../providerErrors';

describe('isRetryable', () => {
  describe('transport-layer errors', () => {
    it('TransportError → true', () => {
      expect(isRetryable(new TransportError('p', 'network dropped'))).toBe(true);
    });

    it('ConnectTimeoutError → true', () => {
      expect(isRetryable(new ConnectTimeoutError('p', 30000))).toBe(true);
    });
  });

  describe('APIError by status code', () => {
    it('500 → true', () => {
      expect(isRetryable(new APIError('p', 500, 'internal'))).toBe(true);
    });

    it('502 → true', () => {
      expect(isRetryable(new APIError('p', 502, 'bad gateway'))).toBe(true);
    });

    it('503 → true', () => {
      expect(isRetryable(new APIError('p', 503, 'unavailable'))).toBe(true);
    });

    it('429 → true (rate limit)', () => {
      expect(isRetryable(new APIError('p', 429, 'rate limited'))).toBe(true);
    });

    it('400 → false (client error)', () => {
      expect(isRetryable(new APIError('p', 400, 'bad request'))).toBe(false);
    });

    it('401 → false (auth error)', () => {
      expect(isRetryable(new APIError('p', 401, 'unauthorized'))).toBe(false);
    });

    it('403 → false (forbidden)', () => {
      expect(isRetryable(new APIError('p', 403, 'forbidden'))).toBe(false);
    });

    it('404 → false', () => {
      expect(isRetryable(new APIError('p', 404, 'not found'))).toBe(false);
    });
  });

  describe('content-layer errors', () => {
    it('EmptyResponseError → true (transient model hiccup)', () => {
      expect(isRetryable(new EmptyResponseError('p'))).toBe(true);
    });

    it('MalformedToolCallError → false (fail-fast)', () => {
      expect(isRetryable(new MalformedToolCallError('p', '{broken'))).toBe(false);
    });

    it('OutputTooLongError → false (fail-fast)', () => {
      expect(isRetryable(new OutputTooLongError('p', 4096, 'partial...'))).toBe(false);
    });
  });

  describe('non-ProviderError values', () => {
    it('plain Error → false', () => {
      expect(isRetryable(new Error('something'))).toBe(false);
    });

    it('null → false', () => {
      expect(isRetryable(null)).toBe(false);
    });

    it('undefined → false', () => {
      expect(isRetryable(undefined)).toBe(false);
    });

    it('string → false', () => {
      expect(isRetryable('503 error')).toBe(false);
    });

    it('plain object → false', () => {
      expect(isRetryable({ statusCode: 500 })).toBe(false);
    });
  });
});
