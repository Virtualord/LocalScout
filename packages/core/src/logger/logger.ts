import { pino, type Logger } from 'pino';
import type { AppConfig } from '../config/env.js';

/** The log levels pino accepts, taken from the validated config type. */
type LogLevel = AppConfig['app']['logLevel'];

/**
 * Structured logging bound to a run and a lead.
 *
 * Every log line in Localscout must be traceable to a run, and where relevant a
 * lead. `createLogger()` returns the base logger; `forRun()` and `forLead()`
 * narrow it. Binding happens once at the top of a run so no call site has to
 * remember to pass identifiers, which is how lines end up unattributable.
 *
 * Call sites pass context as `info(obj, msg)`, not `info(msg, obj)`. pino reads
 * a leading string as the message and ignores a trailing object, so the second
 * form drops fields with no error. `logger.test.ts` pins that behaviour.
 */

export interface RunLogger extends Logger {
  /** A logger that stamps every line with this run id. */
  forRun(runId: string): Logger;
}

export interface LoggerOptions {
  level: LogLevel;
  /** Pretty output for a terminal. Structured JSON is the default. */
  pretty?: boolean;
  /** Bind these fields onto every line. */
  bindings?: Record<string, unknown>;
  /**
   * Destination stream. Defaults to stdout. Tests pass a capture stream so
   * assertions read the same lines an operator would see in a log file.
   */
  destination?: NodeJS.WritableStream;
}

/** Default field bindings applied to every logger in the app. */
function baseBindings(): Record<string, unknown> {
  return { app: 'localscout' };
}

export function createLogger(options: LoggerOptions): Logger {
  const bindings = { ...baseBindings(), ...options.bindings };
  const destination = options.destination ?? pino.destination(1);

  if (options.pretty) {
    // Only for a human watching a terminal; CI and files get JSON.
    return pino({
      level: options.level,
      base: bindings,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,app' },
      },
    });
  }

  return pino({ level: options.level, base: bindings }, destination);
}

/**
 * Narrow a logger to a single run.
 *
 * `runId` is set at run creation and inherited by every child, so an audit or a
 * draft line is attributable without the call site passing anything.
 */
export function forRun(base: Logger, runId: string): Logger {
  return base.child({ runId });
}

/**
 * Narrow a logger further to one lead.
 *
 * Used by the audit and draft steps so every line about a specific business
 * carries that lead's id.
 */
export function forLead(base: Logger, leadId: string): Logger {
  return base.child({ leadId });
}

/**
 * Redact values that must never reach a log file.
 *
 * The API already avoids returning secrets, but a log line that prints an env
 * object or a config dump is an easy way to leak one. Only the key names are
 * shown; the presence of a key is useful signal for debugging setup problems.
 */
export function redactSecrets<T extends Record<string, unknown>>(input: T): T {
  const secretPattern = /(api_key|apikey|token|secret|password|authorization)/i;
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (secretPattern.test(key)) {
      output[key] = value === undefined || value === null || value === '' ? 'unset' : 'set';
      continue;
    }
    output[key] = value;
  }

  return output as T;
}
