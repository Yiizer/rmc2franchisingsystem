import type { Dialect } from './store';

// SQL fragments for the few places where SQLite and Postgres cannot share one statement (phase 4).
// Everything else in the app uses the portable subset (`?` placeholders, ON CONFLICT, quoted aliases).
// Each helper takes the dialect, or any object carrying one (pass `db`). Column and key arguments are
// spliced into SQL text, so they must be literals from code, never user input; they are validated anyway.
// Values always travel as `?` parameters, in the order the fragment documents.

export type DialectSource = Dialect | { readonly dialect: Dialect };
export type JsonKind = 'text' | 'number' | 'bool' | 'json';

const dialectOf = (source: DialectSource): Dialect => typeof source === 'string' ? source : source.dialect;
const COLUMN = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;
const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const column = (value: string) => { if (!COLUMN.test(value)) throw new Error('Unsafe SQL column: ' + value); return value; };
const key = (value: string) => { if (!KEY.test(value)) throw new Error('Unsafe JSON key: ' + value); return value; };

/** Text value of a top-level JSON key (NULL when absent). SQLite json_extract / Postgres ->>. */
export function jsonText(source: DialectSource, col: string, jsonKey: string): string {
  return dialectOf(source) === 'postgres' ? `(${column(col)}->>'${key(jsonKey)}')` : `json_extract(${column(col)},'$.${key(jsonKey)}')`;
}

/** True/false test of a top-level JSON boolean key; missing counts as false. Usable directly in WHERE. */
export function jsonBool(source: DialectSource, col: string, jsonKey: string): string {
  return dialectOf(source) === 'postgres'
    ? `COALESCE((${column(col)}->>'${key(jsonKey)}')::boolean,false)`
    : `(COALESCE(json_extract(${column(col)},'$.${key(jsonKey)}'),0)=1)`;
}

/** A top-level key as JSON text (object, array or scalar), e.g. to JSON.parse in the caller. */
export function jsonRaw(source: DialectSource, col: string, jsonKey: string): string {
  return dialectOf(source) === 'postgres' ? `(${column(col)}->'${key(jsonKey)}')::text` : `json_extract(${column(col)},'$.${key(jsonKey)}')`;
}

/**
 * Expression for SET col = <expr>: the JSON object with the given top-level keys replaced or added.
 * One `?` per key, in the order the keys are given. kind: text (default), number, bool (pass 1 or 0), json (pass JSON text).
 */
export function jsonMerge(source: DialectSource, col: string, entries: readonly (string | { key: string; kind?: JsonKind })[]): string {
  const items = entries.map(entry => typeof entry === 'string' ? { key: entry, kind: 'text' as JsonKind } : { key: entry.key, kind: entry.kind ?? 'text' });
  if (!items.length) throw new Error('jsonMerge needs at least one key');
  if (dialectOf(source) === 'postgres') {
    const cast: Record<JsonKind, string> = { text: '?::text', number: '?::numeric', bool: '?::boolean', json: '?::jsonb' };
    return `${column(col)} || jsonb_build_object(${items.map(item => `'${key(item.key)}',${cast[item.kind]}`).join(',')})`;
  }
  const value: Record<JsonKind, string> = { text: '?', number: '?', bool: `json(CASE WHEN ? THEN 'true' ELSE 'false' END)`, json: 'json(?)' };
  return `json_set(${column(col)},${items.map(item => `'$.${key(item.key)}',${value[item.kind]}`).join(',')})`;
}

/** Expression for SET col = <expr>: appends one `?` value (text, or JSON text when kind is 'json') to the array at a top-level key. */
export function jsonAppend(source: DialectSource, col: string, jsonKey: string, kind: 'text' | 'json' = 'text'): string {
  if (dialectOf(source) === 'postgres') {
    const element = kind === 'json' ? '?::jsonb' : '?::text';
    return `jsonb_set(${column(col)},'{${key(jsonKey)}}',COALESCE(${column(col)}->'${key(jsonKey)}','[]'::jsonb)||jsonb_build_array(${element}))`;
  }
  return `json_insert(${column(col)},'$.${key(jsonKey)}[#]',${kind === 'json' ? 'json(?)' : '?'})`;
}

/** WHERE test: the array at a top-level key contains the text value `?`. (Postgres' own `?` operator would clash with placeholders.) */
export function jsonArrayHas(source: DialectSource, col: string, jsonKey: string): string {
  return dialectOf(source) === 'postgres'
    ? `jsonb_exists(${column(col)}->'${key(jsonKey)}',?::text)`
    : `EXISTS (SELECT 1 FROM json_each(${column(col)},'$.${key(jsonKey)}') WHERE value=?)`;
}

/** Insertion-order column for ORDER BY: SQLite rowid / Postgres identity column `seq`. Optional table alias. */
export function rowOrder(source: DialectSource, alias?: string): string {
  const name = dialectOf(source) === 'postgres' ? 'seq' : 'rowid';
  return alias ? `${column(alias)}.${name}` : name;
}

/** Row-lock suffix for a SELECT, with a leading space: ' FOR UPDATE' on Postgres, empty on SQLite (its write lock is global). */
export function forUpdate(source: DialectSource): string {
  return dialectOf(source) === 'postgres' ? ' FOR UPDATE' : '';
}
