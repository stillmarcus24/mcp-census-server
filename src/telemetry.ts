/**
 * Structured logging to stderr.
 *
 * stdout is the JSON-RPC channel on a stdio transport — anything written there
 * corrupts the protocol stream. This is the single most common way a working
 * MCP server becomes an unparseable one, so logging is confined to stderr by
 * construction rather than by convention.
 */
export type LogFields = Readonly<Record<string, string | number | boolean | undefined>>;

export function log(event: string, fields: LogFields = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...fields });
  process.stderr.write(line + '\n');
}
