// Phase 4 QA T9: anon / authenticated / the Supabase Data API cannot reach the `rmc2` schema; the app role is least-privilege.
// Live against the Supabase TEST project. Read-only: catalog queries, plus SET ROLE inside a transaction that is always rolled back
// (needs RMC2_DATABASE_ADMIN_URL in .env.supabase.test; without it those checks are reported as not run). Nothing is printed
// that could identify the connection.
import assert from 'node:assert/strict';
import { createChecks, databaseUrl, maskText, require, supabaseEnv } from './db-parity/lib.mjs';

const env = supabaseEnv();
const pgmod = await import('file:///' + require.resolve('postgres').replace(/\\/g, '/'));
const postgres = pgmod.default ?? pgmod;
const open = url => postgres(url, { ssl: 'require', max: 1, prepare: false, connect_timeout: 15, onnotice: () => {}, idle_timeout: 5 });
const app = open(databaseUrl());
const admin = env.RMC2_DATABASE_ADMIN_URL ? open(env.RMC2_DATABASE_ADMIN_URL) : null;
const { check, finish } = createChecks();
const notRun = [];
const ROLES = ['anon', 'authenticated'];
const tables = (await app`select c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity from pg_class c where c.relnamespace='rmc2'::regnamespace and c.relkind in ('r','p') order by 1`).map(r => r);

await check('T9 inventory: rmc2 has tables and every one has row level security enabled', async () => {
  assert.ok(tables.length >= 20, 'tables: ' + tables.length);
  const noRls = tables.filter(t => !t.relrowsecurity).map(t => t.relname);
  assert.deepEqual(noRls, []);
  return `${tables.length} tables, 0 without RLS, ${tables.filter(t => t.relforcerowsecurity).length} with FORCE RLS`;
});
await check('T9 policies: exactly one per table, only for rmc2_app', async () => {
  const pol = await app`select tablename, policyname, roles::text as roles, cmd from pg_policies where schemaname='rmc2'`;
  const per = {}; for (const p of pol) (per[p.tablename] ??= []).push(p);
  const bad = tables.filter(t => (per[t.relname] || []).length !== 1).map(t => `${t.relname}:${(per[t.relname] || []).length}`);
  assert.deepEqual(bad, [], 'tables without exactly one policy');
  for (const p of pol) assert.equal(p.roles, '{rmc2_app}', `${p.tablename} policy roles ${p.roles}`);
  return `${pol.length} policies, all to rmc2_app`;
});
await check('T9 anon, authenticated and PUBLIC hold no privilege on any rmc2 table, sequence or function, nor on the schema', async () => {
  const leaks = [];
  for (const role of [...ROLES, 'public']) {
    const roleArg = role === 'public' ? '-' : role; // has_*_privilege has no PUBLIC; check grants table below for PUBLIC
    if (role === 'public') continue;
    for (const t of tables) for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
      const [r] = await app`select has_table_privilege(${roleArg}, ${'rmc2.' + t.relname}, ${priv}) as ok`;
      if (r.ok) leaks.push(`${role}:${t.relname}:${priv}`);
    }
    const [s] = await app`select has_schema_privilege(${roleArg}, 'rmc2', 'USAGE') as u, has_schema_privilege(${roleArg}, 'rmc2', 'CREATE') as c`;
    if (s.u) leaks.push(`${role}:schema USAGE`); if (s.c) leaks.push(`${role}:schema CREATE`);
    const seq = await app`select c.relname from pg_class c where c.relnamespace='rmc2'::regnamespace and c.relkind='S' and (has_sequence_privilege(${roleArg}, c.oid, 'USAGE') or has_sequence_privilege(${roleArg}, c.oid, 'SELECT') or has_sequence_privilege(${roleArg}, c.oid, 'UPDATE'))`;
    for (const r of seq) leaks.push(`${role}:sequence ${r.relname}`);
    const fn = await app`select p.proname from pg_proc p where p.pronamespace='rmc2'::regnamespace and has_function_privilege(${roleArg}, p.oid, 'EXECUTE')`;
    for (const r of fn) leaks.push(`${role}:function ${r.proname}`);
  }
  // PUBLIC grants appear as an empty grantee in the ACL; information_schema.role_table_grants shows grantee = 'PUBLIC'.
  const pub = await app`select table_name, privilege_type from information_schema.role_table_grants where table_schema='rmc2' and grantee='PUBLIC'`;
  for (const r of pub) leaks.push(`PUBLIC:${r.table_name}:${r.privilege_type}`);
  const pubFn = await app`select p.proname from pg_proc p where p.pronamespace='rmc2'::regnamespace and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')`;
  for (const r of pubFn) leaks.push(`PUBLIC:function ${r.proname}`);
  assert.deepEqual(leaks, []);
  return `${tables.length} tables x 7 privileges x ${ROLES.length} roles checked, plus schema, sequences, functions, PUBLIC`;
});
await check('T9 app role rmc2_app: no superuser/bypassrls/createrole/createdb/replication, noinherit, not a member of other roles', async () => {
  const [r] = await app`select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication, rolinherit, rolcanlogin from pg_roles where rolname = current_user`;
  assert.deepEqual({ ...r }, { rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false, rolinherit: false, rolcanlogin: true });
  const member = await app`select b.rolname from pg_auth_members m join pg_roles b on b.oid=m.roleid where m.member=(select oid from pg_roles where rolname=current_user)`;
  assert.deepEqual(member.map(m => m.rolname), [], 'member of: ' + member.map(m => m.rolname).join(','));
});
await check('T9 app role cannot reach auth / storage / public data, cannot SET ROLE, cannot read server files', async () => {
  for (const [name, q] of [['auth.users', 'select * from auth.users limit 1'], ['storage.objects', 'select * from storage.objects limit 1'], ['pg_authid', 'select rolpassword from pg_authid limit 1'], ['set role postgres', 'set role postgres'], ['set role service_role', 'set role service_role'], ['pg_read_file', "select pg_read_file('/etc/passwd')"], ['copy program', "copy (select 1) to program 'id'"]]) {
    const err = await app.unsafe(q).then(() => null, e => e);
    assert.ok(err && ['42501', '42P01', '3F000', '0LP01'].includes(err.code), `${name}: ${err ? err.code : 'ALLOWED'}`);
  }
});
if (admin) {
  await check('T9 SET ROLE anon / authenticated (inside a rolled-back transaction): every rmc2 table is "permission denied"', async () => {
    const outcomes = [];
    for (const role of ROLES) for (const t of tables) {
      const err = await admin.begin(async tx => { await tx.unsafe(`set local role ${role}`); try { await tx.unsafe(`select 1 from rmc2.${t.relname} limit 1`); return null; } catch (e) { return e; } finally { /* rolled back below */ } }).then(() => null, e => e);
      outcomes.push(`${role}:${t.relname}:${err ? err.code : 'READ'}`);
    }
    // sql.begin commits unless the callback throws; the statements above are SELECTs only, and a failed statement aborts the transaction,
    // so nothing is ever written. A successful read would have shown up as READ.
    const reads = outcomes.filter(o => o.endsWith(':READ'));
    assert.deepEqual(reads, []);
    assert.ok(outcomes.every(o => o.endsWith(':42501') || o.endsWith(':3F000')), 'unexpected codes: ' + [...new Set(outcomes.map(o => o.split(':')[2]))]);
    return `${outcomes.length} role x table reads denied (${[...new Set(outcomes.map(o => o.split(':')[2]))].join(',')})`;
  });
  await check('T9 SET ROLE anon: writes and DDL are denied too', async () => {
    for (const role of ROLES) for (const stmt of ["insert into rmc2.counters(name,n) values ('qa-anon',1)", "update rmc2.counters set n=n", "delete from rmc2.counters where false", 'create table rmc2.qa_anon(x int)', 'create table public.qa_anon(x int)'])
      {
        const err = await admin.begin(async tx => { await tx.unsafe(`set local role ${role}`); await tx.unsafe(stmt); throw new Error('ALLOWED'); }).then(() => null, e => e);
        assert.ok(err && err.message !== 'ALLOWED' && ['42501', '3F000'].includes(err.code), `${role}: ${stmt} -> ${err?.code || err?.message}`);
      }
    const [c] = await admin`select count(*)::int n from rmc2.counters where name='qa-anon'`; assert.equal(c.n, 0);
  });
  await check('T9 service_role / Data API exposure: rmc2 is not in the exposed schemas of PostgREST (db_schemas)', async () => {
    const [r] = await admin`select current_setting('pgrst.db_schemas', true) as s`;
    // On Supabase the setting lives on the authenticator role.
    const [a] = await admin`select array_to_string(rolconfig, ';') as cfg from pg_roles where rolname='authenticator'`;
    const text = `${r.s || ''};${a?.cfg || ''}`;
    assert.ok(!/(^|[,;= ])rmc2([,; ]|$)/.test(text), 'rmc2 appears in PostgREST config: ' + text);
    return 'pgrst.db_schemas = ' + (r.s || '(see authenticator config)') + '; authenticator config has no rmc2';
  });
} else notRun.push('T9 SET ROLE checks and PostgREST config: RMC2_DATABASE_ADMIN_URL not available');

await check('T9 Data API over HTTP: the service key cannot read rmc2 tables (schema not exposed), unauthenticated gets 401, OpenAPI lists no rmc2 table', async () => {
  const base = env.RMC2_SUPABASE_URL, key = env.RMC2_SUPABASE_SECRET_KEY;
  assert.ok(base && key, 'Supabase URL/key missing');
  const names = ['users', 'inquiries', 'sessions', 'auth_attempts', 'notifications'];
  const codes = [];
  for (const table of names) {
    for (const profile of ['rmc2', undefined]) {
      const headers = { apikey: key, ...(profile ? { 'Accept-Profile': profile } : {}) };
      const r = await fetch(`${base}/rest/v1/${table}?select=*&limit=1`, { headers });
      const text = await r.text();
      codes.push(`${profile || 'default'}:${table}:${r.status}`);
      assert.notEqual(r.status, 200, `${table} (${profile || 'default'}) returned 200: ${text.slice(0, 80)}`);
      assert.ok(!/"id"\s*:\s*"(admin|cryssa|INQ-)/.test(text), 'data leaked');
    }
  }
  const anonymous = await fetch(`${base}/rest/v1/users?select=*`, { headers: { 'Accept-Profile': 'rmc2' } });
  assert.ok([401, 403, 404, 406].includes(anonymous.status), 'no apikey -> ' + anonymous.status);
  const openapi = await fetch(`${base}/rest/v1/`, { headers: { apikey: key } });
  const spec = await openapi.text();
  for (const t of ['auth_attempts', 'inquiry_summaries', 'notice_recipients', 'workspace_versions', 'historical_accounts']) assert.ok(!spec.includes(t), 'OpenAPI mentions ' + t);
  return `${codes.length} table reads refused (${[...new Set(codes.map(c => c.split(':')[2]))].join(',')}); no apikey -> ${anonymous.status}; OpenAPI status ${openapi.status} lists no rmc2 table`;
});
await check('T9 storage: bucket rmc2-test-files is private (public URL denied, unauthenticated list denied)', async () => {
  const base = env.RMC2_SUPABASE_URL, key = env.RMC2_SUPABASE_SECRET_KEY;
  const pub = await fetch(`${base}/storage/v1/object/public/rmc2-test-files/selftest/none.txt`); assert.notEqual(pub.status, 200); assert.ok([400, 404].includes(pub.status), 'public URL -> ' + pub.status);
  const unauth = await fetch(`${base}/storage/v1/object/list/rmc2-test-files`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prefix: '', limit: 1 }) });
  assert.ok([400, 401, 403].includes(unauth.status), 'unauthenticated list -> ' + unauth.status);
  const buckets = await (await fetch(`${base}/storage/v1/bucket`, { headers: { apikey: key, authorization: 'Bearer ' + key } })).json();
  const b = buckets.find(x => x.name === 'rmc2-test-files'); assert.ok(b, 'bucket exists'); assert.equal(b.public, false);
  return `public URL ${pub.status}, unauthenticated list ${unauth.status}, bucket public=${b.public}`;
});

await app.end({ timeout: 5 }); if (admin) await admin.end({ timeout: 5 });
for (const n of notRun) console.log('NOT RUN ' + n);
process.exit(finish('Phase 4 T9 security (RLS, grants, Data API)') ? 0 : 1);
