// REMAINING_WORK §2: the app connection verifies the Supabase certificate when RMC2_DATABASE_CA is set, and a paused
// project gives a plain 503 message. Pure checks, no database.   node scripts/test-db-connection.mjs
import assert from 'node:assert/strict';
import { register } from 'tsx/esm/api';
register();
const { buildClientOptions, mapPgError } = await import('../lib/operations/store-postgres.ts');
const url = 'postgresql://rmc2_app.x:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres';
const pem = '-----BEGIN CERTIFICATE-----\nMIIBxx\n-----END CERTIFICATE-----';
assert.equal(buildClientOptions(url, {}).ssl, 'require'); console.log('PASS No CA: encrypted (require), as before');
const verified = buildClientOptions(url, { RMC2_DATABASE_CA: pem.replace(/\n/g, '\n') }).ssl;
assert.equal(verified.rejectUnauthorized, true); assert.equal(verified.ca, pem); console.log('PASS CA set (one-line env value): certificate and host name are verified');
assert.throws(() => buildClientOptions(url, { RMC2_DATABASE_SSL: 'verify-full' }), /needs RMC2_DATABASE_CA/); console.log('PASS verify-full without a CA refuses to start');
assert.throws(() => buildClientOptions(url, { RMC2_DATABASE_CA: 'not a cert' }), /PEM/); console.log('PASS A CA that is not a PEM certificate is refused');
assert.throws(() => buildClientOptions(url, { RMC2_DATABASE_SSL: 'disable' }), /localhost/); console.log('PASS Plain connections stay localhost-only');
const paused = Object.assign(new Error('Tenant or user not found'), { name: 'PostgresError', code: 'XX000' });
const mapped = mapPgError(paused); assert.equal(mapped.status, 503); assert.match(mapped.message, /paused/); console.log('PASS A paused project answers 503 "may be paused", not a 500');
const refused = mapPgError(Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:6543'), { code: 'ECONNREFUSED' })); assert.equal(refused.status, 503); assert.ok(!/10.0.0.1/.test(refused.message)); console.log('PASS An unreachable host answers 503 without the address');
const other = mapPgError(Object.assign(new Error('relation "secret_table" does not exist'), { name: 'PostgresError', code: '42P01' })); assert.equal(other.status, 500); assert.ok(!/secret_table/.test(other.message)); console.log('PASS Other database errors stay 500 with no details');
console.log('8 checks passed');
