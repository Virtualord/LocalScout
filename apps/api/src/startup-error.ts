import { ConfigError } from '@localscout/core';

/**
 * Startup failures, in words.
 *
 * `startServer` rejects with the raw Node error, and at the top level that used
 * to surface as an unhandled rejection: a stack trace about
 * `Server.setupListenHandle`, which tells a developer nothing about what to do.
 * A port already in use is the most common first-run failure after a bad `.env`,
 * so it gets the same treatment as a configuration error.
 *
 * Both functions return a message rather than writing one or calling
 * `process.exit`, so each entrypoint decides what to do with it and a test can
 * assert the wording without killing the test runner.
 */

/**
 * The rendering a `ConfigError` gets, or `undefined` when this is not one.
 *
 * `boot` throws rather than printing, because it is called by the API, the CLI
 * and the tests, and what to do next is not its decision to make. This is that
 * decision's shared half: both entrypoints print the same sentence, and an error
 * that is not a configuration problem is left for the caller to rethrow.
 *
 * The message is built by the loader and names the variables to fix, so it is
 * already a sentence. It gets blank lines around it, never a stack trace.
 */
export function describeConfigError(error: unknown): string | undefined {
  if (!(error instanceof ConfigError)) return undefined;
  return `\n${error.message}\n\n`;
}

/**
 * Explain a startup failure in words.
 *
 * Returns the message rather than calling `process.exit`, so it can be asserted
 * in a test without killing the test runner.
 */
export function describeStartupError(error: unknown, port: number): string {
  const fromConfig = describeConfigError(error);
  if (fromConfig !== undefined) return fromConfig;

  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';

  if (code === 'EADDRINUSE') {
    return [
      '',
      `Port ${port} is already in use, so the API cannot start.`,
      '',
      'Another Localscout process is probably still running. Find it and stop it:',
      '',
      `  lsof -ti tcp:${port} | xargs kill`,
      '',
      'Or start on a different port:',
      '',
      `  API_PORT=${port + 1} pnpm dev`,
      '',
    ].join('\n');
  }

  if (code === 'EACCES') {
    return [
      '',
      `Not allowed to bind port ${port}.`,
      '',
      'On Linux, ports below 1024 need elevated privileges. Localscout defaults to',
      `8787, so this usually means something overrode it. Try: API_PORT=8788 pnpm dev`,
      '',
    ].join('\n');
  }

  // Anything else still gets a plain line rather than a stack trace, and the
  // stack goes to the logger where it belongs.
  const message = error instanceof Error ? error.message : String(error);
  return `\nThe API could not start: ${message}\n`;
}
