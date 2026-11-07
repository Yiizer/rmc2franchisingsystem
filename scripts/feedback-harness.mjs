// Shared setup for the feedback-round (2026-11-07) tests: transpiles lib/operations into a throwaway folder and points the app at a
// throwaway SQLite data dir under test-results/. Nothing here touches Postgres, the network or a real mailbox.
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';

export async function setup(name) {
  for (const key of Object.keys(process.env)) if (/^RMC2_(MAIL|SMTP|DB)/.test(key) || key === 'VERCEL') delete process.env[key]; // local SQLite, local mail
  const out = path.resolve('test-results/' + name + '/' + Date.now());
  await mkdir(out, { recursive: true });
  process.env.RMC2_DATA_DIR = path.join(out, 'qa-data');
  assert.ok(process.env.RMC2_DATA_DIR.startsWith(path.resolve('test-results') + path.sep));
  for (const file of await readdir('lib/operations')) if (file.endsWith('.ts')) {
    const code = ts.transpileModule(await readFile('lib/operations/' + file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText.replace(/(from\s+['"]\.\/[^'"]+)(['"])/g, '$1.mjs$2');
    await writeFile(path.join(out, file.replace(/\.ts$/, '.mjs')), code);
  }
  const load = file => import(pathToFileURL(path.join(out, file + '.mjs')));
  const database = await load('database');
  const users = await database.allUsers();
  const checks = [];
  const pass = text => { checks.push(text); console.log('PASS ' + text); };
  const user = id => { const found = users.find(person => person.id === id); assert.ok(found, id); return found; };
  const status = async promise => { try { await promise; return 200; } catch (error) { return error.name === 'ZodError' ? 400 : error.status ?? ('ERR ' + (error.name || '') + ' ' + error.message); } };
  const sessions = new Map();
  const session = async who => { if (!sessions.has(who.id)) { const token = 'tok-' + who.id + '-' + randomUUID(); await database.db.run('INSERT INTO sessions(token,user_id,expires) VALUES (?,?,?)', token, who.id, new Date(Date.now() + 3600000).toISOString()); sessions.set(who.id, token); } return sessions.get(who.id); };
  const get = async id => JSON.parse((await database.db.get('SELECT data FROM inquiries WHERE id=?', id)).data);
  return { load, database, db: database.db, users, user, pass, checks, status, session, get, out, PASSWORD: database.LOCAL_PASSWORD };
}
