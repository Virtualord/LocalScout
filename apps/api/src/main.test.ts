import { describe, expect, it } from 'vitest';
import { describeStartupError } from './main.js';

/**
 * The startup failure message.
 *
 * A port clash used to surface as an unhandled rejection: a stack trace about
 * `Server.setupListenHandle`, which tells a developer nothing. `pnpm dev` failing
 * with `EADDRINUSE` is the single most common first-run problem after a bad
 * `.env`, so the message has to name the port and give a command that works.
 */
const portInUse = Object.assign(
  new Error('listen EADDRINUSE: address already in use 127.0.0.1:8787'),
  {
    code: 'EADDRINUSE',
  },
);

describe('describeStartupError', () => {
  describe('EADDRINUSE', () => {
    const message = describeStartupError(portInUse, 8787);

    it('names the port', () => {
      expect(message).toContain('8787');
    });

    it('says the port is in use rather than showing a stack trace', () => {
      expect(message).toMatch(/already in use/i);
      expect(message).not.toMatch(/at .*\(.*:\d+:\d+\)/);
    });

    it('offers a command that frees the port', () => {
      expect(message).toMatch(/lsof -ti tcp:8787 \| xargs kill/);
    });

    it('offers a way to run on another port', () => {
      expect(message).toContain('API_PORT=8788');
    });

    it('uses the port it was given rather than a hardcoded one', () => {
      expect(describeStartupError(portInUse, 9999)).toContain('9999');
      expect(describeStartupError(portInUse, 9999)).not.toContain('8787');
    });
  });

  describe('EACCES', () => {
    it('explains the privilege problem without assuming root', () => {
      const message = describeStartupError(
        Object.assign(new Error('bind'), { code: 'EACCES' }),
        80,
      );
      expect(message).toMatch(/privileg|elevated/i);
      expect(message).toMatch(/API_PORT/);
    });
  });

  describe('anything else', () => {
    it('still produces one readable line instead of a stack trace', () => {
      const message = describeStartupError(new Error('something odd happened'), 8787);
      expect(message).toContain('something odd happened');
      expect(message).not.toMatch(/at .*\(.*:\d+:\d+\)/);
    });

    it('copes with a thrown non-error', () => {
      expect(describeStartupError('a bare string', 8787)).toContain('a bare string');
    });

    it('copes with null', () => {
      expect(() => describeStartupError(null, 8787)).not.toThrow();
    });

    it('copes with an error carrying no code', () => {
      expect(() => describeStartupError({}, 8787)).not.toThrow();
    });
  });

  it('never returns an empty message, whatever it is handed', () => {
    const inputs: unknown[] = [
      portInUse,
      new Error('x'),
      'string',
      null,
      undefined,
      42,
      { code: 'EADDRINUSE' },
      { code: 123 },
    ];

    for (const input of inputs) {
      expect(describeStartupError(input, 8787).length).toBeGreaterThan(0);
    }
  });
});
