/**
 * The single place the product name lives.
 *
 * Renaming Localscout is a one-line change here plus a search for the literal
 * in fixtures and docs; nothing builds the name from fragments at runtime.
 */
export const APP_NAME = 'Localscout';

/** Used in the honest user agent sent on every audit request. */
export const APP_USER_AGENT = `${APP_NAME}Audit`;

/** Package version, surfaced in the user agent and the health endpoint. */
export const APP_VERSION = '0.1.0';
