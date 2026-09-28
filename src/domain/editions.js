/**
 * The FC/FIFA edition new teams and championships default to. Keep this in sync with the literal
 * default used in src/db/schema.sql and src/db/connection.js's migrations (SQL DEFAULT clauses can't
 * reference a JS constant).
 */
export const DEFAULT_EDITION = 'FC 27';
