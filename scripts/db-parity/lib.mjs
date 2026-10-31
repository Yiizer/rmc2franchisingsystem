// Shared helpers for the Phase 4 Postgres QA scripts (scripts/test-pg-*.mjs, scripts/db-parity/*).
// Test-only. Credentials come from the environment or the git-ignored .env.supabase.test and are never printed.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseEnv } from 'node:util';

export const root = path.resolve(import.meta.dirname, '..', '..');
export const LOCAL_PASSWORD = 'Rmc2Local!2026';
export const require = createRequire(path.join(root, 'package.json'));

/** Reads .env.supabase.test (if present) without printing anything. */
export function supabaseEnv() {
  const file = path.join(root, '.env.supabase.test');
  return existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
}
/** The app-role URL: from the environment, else from .env.supabase.test. Throws (without the value) when missing. */
export function databaseUrl() {
  const url = process.env.RMC2_DATABASE_URL || supabaseEnv().RMC2_DATABASE_URL;
  if (!url) throw new Error('RMC2_DATABASE_URL is not set and .env.supabase.test has none.');
  return url;
}
/** Masks anything that looks like a connection string, host of the URL, or a secret key. */
export function maskText(text) {
  let out = String(text).replace(/postgres(ql)?:\/\/\S+/g, 'postgres://***').replace(/sb_secret_\w+/g, '<key>');
  try { const u = new URL(databaseUrl()); for (const s of [u.hostname, decodeURIComponent(u.password), u.password].filter(Boolean)) out = out.split(s).join('<masked>'); } catch { /* none */ }
  return out;
}

export function createChecks() {
  const results = [];
  const check = async (name, fn) => {
    const started = Date.now();
    try { const detail = await fn(); results.push({ name, ok: true }); console.log('PASS ' + name + (detail ? ' :: ' + maskText(detail) : '') + ` (${((Date.now() - started) / 1000).toFixed(1)}s)`); }
    catch (error) { results.push({ name, ok: false, error: maskText(error?.stack || error) }); console.log('FAIL ' + name + ' :: ' + maskText(error?.message || error).split('\n')[0]); }
  };
  const finish = (title) => {
    const failed = results.filter(r => !r.ok);
    console.log(`\n${title}: ${results.length - failed.length}/${results.length} passed${failed.length ? ', FAILED: ' + failed.map(f => f.name).join(' | ') : ''}`);
    process.exitCode = failed.length ? 1 : 0;
    return failed.length === 0;
  };
  return { check, finish, results };
}
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ------------------------------------------------------------------ HTTP helpers
export function client(base) {
  const api = base.replace(/\/$/, '') + '/api/operations/';
  const sessions = {};
  const login = async (who, password = LOCAL_PASSWORD) => {
    const response = await fetch(api + 'login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: who + '@rmc2.local', password }) });
    if (response.ok) sessions[who] = response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    return response;
  };
  const raw = (who, route, body, init = {}) => fetch(api + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(sessions[who] ? { cookie: sessions[who] } : {}), ...(body === undefined || body instanceof FormData ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body), ...init,
  });
  const call = async (who, route, body, expected) => {
    const response = await raw(who, route, body);
    const type = response.headers.get('content-type') || '';
    const value = type.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer());
    if (expected !== undefined) assert.equal(response.status, expected, route + ': ' + JSON.stringify(value).slice(0, 300));
    return { status: response.status, value };
  };
  return { base, api, sessions, login, raw, call };
}

let ExcelJS;
/** A sample form whose identity (company, contact, address, a unique file hash) is replaced; same identity -> same client. */
export async function formBytes(base, who, identity, extra = {}) {
  ExcelJS ??= (await import('file:///' + require.resolve('exceljs').replace(/\\/g, '/'))).default;
  const sample = await (await fetch(base.replace(/\/$/, '') + '/api/operations/sample-form', { headers: { cookie: who } })).arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(sample));
  const sheet = workbook.worksheets[0];
  for (const cell of ['B10', 'D14', 'B21']) sheet.getCell(cell).value = identity;
  for (const [cell, value] of Object.entries(extra)) sheet.getCell(cell).value = value;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
export function intakeForm(bytes, sender, name = 'qa.xlsx') {
  const form = new FormData();
  form.append('file', new File([bytes], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  form.append('sender', sender);
  return form;
}
export const uniq = () => randomUUID().slice(0, 8);
