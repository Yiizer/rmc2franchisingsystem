// Divisions can be added and deleted by the Head (PO 2026-11-13). SQLite, throwaway data dir.   node scripts/test-division-edit.mjs
import assert from 'node:assert/strict';
import { setup } from './feedback-harness.mjs';

const t = await setup('division-edit');
const store = await t.load('division-store'), accounts = await t.load('accounts'), divisions = await t.load('divisions'), names = await t.load('division-table');
const head = t.user('emerson'), zeo = t.user('zeo'), cryssa = t.user('cryssa');
const current = async () => (await store.getDivisionTable()).divisions;
const withDivision = (list, extra) => ({ divisions: [...list.map(({ name, divisionAliases, branches }) => ({ name, divisionAliases, branches })), ...extra] });

// 1. Add a division (with a branch); only the Head may.
const base = await current();
assert.equal(await t.status(store.saveDivisionTable(zeo, withDivision(base, [{ name: 'Division 8', divisionAliases: [], branches: [] }]))), 403);
assert.equal(await t.status(store.saveDivisionTable(cryssa, withDivision(base, []))), 403);
await store.saveDivisionTable(head, withDivision(base, [{ name: 'Division 8', divisionAliases: ['visayas'], branches: [{ name: 'Iloilo', aliases: ['iloilo city'] }] }]));
assert.deepEqual((await names.divisionNames()).slice(-1), ['Division 8']);
const table = await store.getDivisionTable();
assert.equal(divisions.classifyBranch('Iloilo City', table).division, 'Division 8');
assert.equal(divisions.classifyBranch('Div 8', table).division, 'Division 8');
assert.equal(divisions.classifyBranch('DIV VIII', table).division, 'Unassigned', 'only labels the classifier knows');
t.pass('The Head adds "Division 8" with a branch; it is in the division list and old records saying "Iloilo City" or "Div 8" sort into it; a Supervisor and an Employee are refused (403)');

// 2. Accounts accept only divisions in the table.
const create = division => accounts.createAccount(head, { name: 'QA Division Head ' + division, username: 'qa.dh.' + division.replace(/\W/g, '').toLowerCase(), email: 'qa.dh.' + division.replace(/\W/g, '').toLowerCase() + '@example.test', role: 'DivisionHead', position: 'Division Head', canApprove: false, division, currentPassword: t.PASSWORD });
const made = await create('Division 8');
assert.equal(made.user.division, 'Division 8');
assert.equal(await t.status(create('Division 99')), 400);
t.pass('A Division Head can be created in the new division; an unknown division is refused (400)');

// 3. A division with people assigned cannot be deleted; move them, then it can.
const without8 = { divisions: (await current()).filter(d => d.name !== 'Division 8').map(({ name, divisionAliases, branches }) => ({ name, divisionAliases, branches })) };
const refused = await store.saveDivisionTable(head, without8).then(() => null, e => e);
assert.equal(refused?.status, 409); assert.match(refused.message, /Division 8 still has 1 person assigned/);
assert.ok((await names.divisionNames()).includes('Division 8'), 'nothing changed');
await accounts.updateAccount(head, { id: made.user.id, active: true, role: 'DivisionHead', canApprove: false, division: 'Division 4' });
await store.saveDivisionTable(head, without8);
assert.equal((await names.divisionNames()).includes('Division 8'), false);
assert.equal(divisions.classifyBranch('Div 8', await store.getDivisionTable()).division, 'Unassigned');
t.pass('Deleting a division that still has someone assigned is refused (409, names the division and the count); after moving them it deletes, and its old records sort as Unassigned');

// 4. A person already in a division keeps it while other edits happen; names must be unique and not "Unassigned".
await accounts.updateAccount(head, { id: made.user.id, active: true, role: 'DivisionHead', canApprove: false, position: 'Division Head (moved)' });
const two = withDivision(await current(), [{ name: 'division 4', divisionAliases: [], branches: [] }]);
assert.equal(await t.status(store.saveDivisionTable(head, two)), 422);
assert.equal(await t.status(store.saveDivisionTable(head, withDivision(await current(), [{ name: 'Unassigned', divisionAliases: [], branches: [] }]))), 422);
assert.equal(await t.status(store.saveDivisionTable(head, { divisions: [] })), 400);
t.pass('Duplicate names (any case) and "Unassigned" are refused (422); an empty list is refused (400); editing a person without changing their division works');
console.log(t.checks.length + ' checks passed');
