import { NodebbAuthMode, toNodebbAuthMode } from './types';

describe('toNodebbAuthMode', () => {
  describe('valid string inputs', () => {
    it('maps "api_token" to NodebbAuthMode.API_TOKEN', () => {
      expect(toNodebbAuthMode('api_token')).toBe(NodebbAuthMode.API_TOKEN);
    });

    it('maps "session" to NodebbAuthMode.SESSION', () => {
      expect(toNodebbAuthMode('session')).toBe(NodebbAuthMode.SESSION);
    });

    it('maps "none" to NodebbAuthMode.NONE', () => {
      expect(toNodebbAuthMode('none')).toBe(NodebbAuthMode.NONE);
    });
  });

  describe('invalid inputs', () => {
    it('throws on unknown string value', () => {
      expect(() => toNodebbAuthMode('invalid')).toThrow(
        /Invalid NODEBB_AUTH_MODE.*"invalid"/,
      );
    });

    it('throws on empty string', () => {
      expect(() => toNodebbAuthMode('')).toThrow(/Invalid NODEBB_AUTH_MODE/);
    });

    it('throws on number input', () => {
      expect(() => toNodebbAuthMode(42)).toThrow(
        /Invalid NODEBB_AUTH_MODE.*expected a string.*number/,
      );
    });

    it('throws on null input', () => {
      expect(() => toNodebbAuthMode(null)).toThrow(
        /Invalid NODEBB_AUTH_MODE.*expected a string.*object/,
      );
    });

    it('throws on undefined input', () => {
      expect(() => toNodebbAuthMode(undefined)).toThrow(
        /Invalid NODEBB_AUTH_MODE.*expected a string.*undefined/,
      );
    });

    it('throws on boolean input', () => {
      expect(() => toNodebbAuthMode(true)).toThrow(
        /Invalid NODEBB_AUTH_MODE.*expected a string.*boolean/,
      );
    });

    it('is case-sensitive', () => {
      expect(() => toNodebbAuthMode('API_TOKEN')).toThrow(
        /Invalid NODEBB_AUTH_MODE/,
      );
    });
  });
});
