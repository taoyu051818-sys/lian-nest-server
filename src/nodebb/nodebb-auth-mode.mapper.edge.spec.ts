import { toNodebbAuthMode, NodebbAuthMode } from './types';

/**
 * Edge-case regression tests for toNodebbAuthMode.
 *
 * Supplements the happy-path and basic invalid-input coverage in
 * nodebb-auth-mode.mapper.spec.ts with boundary conditions:
 * whitespace, mixed-case, non-primitive types, and prototype-key strings.
 */

describe('toNodebbAuthMode edge cases', () => {
  describe('whitespace-padded strings', () => {
    it('throws on leading whitespace', () => {
      expect(() => toNodebbAuthMode(' api_token')).toThrow(
        /Invalid NODEBB_AUTH_MODE/,
      );
    });

    it('throws on trailing whitespace', () => {
      expect(() => toNodebbAuthMode('api_token ')).toThrow(
        /Invalid NODEBB_AUTH_MODE/,
      );
    });

    it('throws on leading and trailing whitespace', () => {
      expect(() => toNodebbAuthMode(' session ')).toThrow(
        /Invalid NODEBB_AUTH_MODE/,
      );
    });

    it('throws on only whitespace', () => {
      expect(() => toNodebbAuthMode('   ')).toThrow(
        /Invalid NODEBB_AUTH_MODE/,
      );
    });

    it('throws on tab character', () => {
      expect(() => toNodebbAuthMode('\t')).toThrow(
        /Invalid NODEBB_AUTH_MODE/,
      );
    });

    it('throws on newline', () => {
      expect(() => toNodebbAuthMode('\n')).toThrow(
        /Invalid NODEBB_AUTH_MODE/,
      );
    });
  });

  describe('case sensitivity beyond all-caps', () => {
    it('throws on title-case "Api_Token"', () => {
      expect(() => toNodebbAuthMode('Api_Token')).toThrow(
        /Invalid NODEBB_AUTH_MODE/,
      );
    });

    it('throws on title-case "Session"', () => {
      expect(() => toNodebbAuthMode('Session')).toThrow(
        /Invalid NODEBB_AUTH_MODE/,
      );
    });

    it('throws on mixed-case "aPi_tOkEn"', () => {
      expect(() => toNodebbAuthMode('aPi_tOkEn')).toThrow(
        /Invalid NODEBB_AUTH_MODE/,
      );
    });

    it('throws on lowercase variant "NONE" differing only in case from valid key', () => {
      expect(() => toNodebbAuthMode('None')).toThrow(
        /Invalid NODEBB_AUTH_MODE/,
      );
    });
  });

  describe('non-primitive types', () => {
    it('throws on plain object', () => {
      expect(() => toNodebbAuthMode({})).toThrow(
        /expected a string.*object/,
      );
    });

    it('throws on object with mode key', () => {
      expect(() => toNodebbAuthMode({ mode: 'api_token' })).toThrow(
        /expected a string.*object/,
      );
    });

    it('throws on array', () => {
      expect(() => toNodebbAuthMode([])).toThrow(
        /expected a string.*object/,
      );
    });

    it('throws on array with valid string element', () => {
      expect(() => toNodebbAuthMode(['api_token'])).toThrow(
        /expected a string.*object/,
      );
    });

    it('throws on function', () => {
      expect(() => toNodebbAuthMode(() => 'api_token')).toThrow(
        /expected a string.*function/,
      );
    });
  });

  describe('special numeric values', () => {
    it('throws on NaN', () => {
      expect(() => toNodebbAuthMode(NaN)).toThrow(
        /expected a string.*number/,
      );
    });

    it('throws on Infinity', () => {
      expect(() => toNodebbAuthMode(Infinity)).toThrow(
        /expected a string.*number/,
      );
    });

    it('throws on negative zero', () => {
      expect(() => toNodebbAuthMode(-0)).toThrow(
        /expected a string.*number/,
      );
    });
  });

  describe('String object wrapper', () => {
    it('throws on String object (typeof is object)', () => {
      // eslint-disable-next-line no-new-wrappers
      expect(() => toNodebbAuthMode(new String('api_token'))).toThrow(
        /expected a string.*object/,
      );
    });
  });

  describe('prototype-key strings (inherited property lookup)', () => {
    it('"__proto__" resolves via Object.prototype and returns a non-enum value', () => {
      // AUTH_MODE_MAP is a plain object; "__proto__" resolves to Object.prototype.
      // The mapper returns it without throwing — a known prototype-pollution surface.
      const result = toNodebbAuthMode('__proto__');
      expect(result).not.toBe(NodebbAuthMode.API_TOKEN);
      expect(result).not.toBe(NodebbAuthMode.SESSION);
      expect(result).not.toBe(NodebbAuthMode.NONE);
    });

    it('"constructor" resolves via Object.prototype and returns a non-enum value', () => {
      const result = toNodebbAuthMode('constructor');
      expect(result).not.toBe(NodebbAuthMode.API_TOKEN);
      expect(result).not.toBe(NodebbAuthMode.SESSION);
      expect(result).not.toBe(NodebbAuthMode.NONE);
    });

    it('"toString" resolves via Object.prototype and returns a non-enum value', () => {
      const result = toNodebbAuthMode('toString');
      expect(result).not.toBe(NodebbAuthMode.API_TOKEN);
      expect(result).not.toBe(NodebbAuthMode.SESSION);
      expect(result).not.toBe(NodebbAuthMode.NONE);
    });
  });

  describe('error message shape', () => {
    it('includes received type for non-string input', () => {
      expect(() => toNodebbAuthMode(42)).toThrow('got number');
    });

    it('includes received value for unknown string', () => {
      expect(() => toNodebbAuthMode('bogus')).toThrow('"bogus"');
    });

    it('lists all valid keys in error message', () => {
      expect(() => toNodebbAuthMode('bogus')).toThrow(
        /api_token, session, none/,
      );
    });
  });

  describe('enum value integrity', () => {
    it('enum values match their string keys', () => {
      expect(NodebbAuthMode.API_TOKEN).toBe('api_token');
      expect(NodebbAuthMode.SESSION).toBe('session');
      expect(NodebbAuthMode.NONE).toBe('none');
    });

    it('all enum values round-trip through the mapper', () => {
      for (const mode of Object.values(NodebbAuthMode)) {
        expect(toNodebbAuthMode(mode)).toBe(mode);
      }
    });
  });
});
