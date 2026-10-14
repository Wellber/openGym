/* Personal trainer mode end to end: the real server.js in a child, three profiles — an admin who
   grants the role, a trainer, a student — plus an outsider trainer who must see nothing. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
function mintSession(uid) {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
const ADMIN = 'u_adm', TRAINER = 'u_tr', STUDENT = 'u_st', OTHER = 'u_ot';

async function startServer(t, extraEnv = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-trainer-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [
      { id: ADMIN, name: 'Admin', created: now, admin: true },
      { id: TRAINER, name: 'Coach Ana', created: now },
      { id: STUDENT, name: 'Bruno', created: now },
      { id: OTHER, name: 'Other', created: now, trainer: true }
    ], creds: [], subs: [], invites: []
  }));
  fs.writeFileSync(path.join(dataDir, `state-${STUDENT}.json`), JSON.stringify({
    _rev: 3, _wid: 'w3', unit: 'kg', routines: [{ id: 'r1', name: 'Own', ex: [] }], week: {},
    workouts: [{ id: 'w1', d: '2026-10-10', name: 'Own', media: [{ hash: 'a'.repeat(64) }] }],
    bodyweight: [{ d: '2026-10-10', w: 81 }], coach: { secret: 'x' }
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', ...extraEnv }
  });
  let log = '';
  child.stdout.on('data', d => log += d);
  child.stderr.on('data', d => log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const api = `http://127.0.0.1:${await boundPort(child, () => log)}`;
  const call = (uid, method, p, body) => fetch(api + p, {
    method, headers: { Cookie: `gymsid=${mintSession(uid)}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {})
  }).then(async r => ({ status: r.status, body: await r.json() }));
  const db = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  const anon = (p, body) => fetch(api + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async r => ({ status: r.status, body: await r.json() }));
  return { call, anon, db, dataDir, state: () => JSON.parse(fs.readFileSync(path.join(dataDir, `state-${STUDENT}.json`), 'utf8')) };
}

test('trainer flow: grant, link, read, save, lock, unlink', async t => {
  const { call, state } = await startServer(t);

  assert.equal((await call(TRAINER, 'GET', '/api/trainer/students')).status, 403, 'not a trainer yet');
  assert.equal((await call(TRAINER, 'POST', '/api/admin/user/trainer', { id: TRAINER, trainer: true })).status, 403, 'only an admin grants');
  assert.equal((await call(ADMIN, 'POST', '/api/admin/user/trainer', { id: TRAINER, trainer: true })).status, 200);
  assert.equal((await call(TRAINER, 'GET', '/api/me')).body.user.trainer, true);

  const { code } = (await call(TRAINER, 'POST', '/api/trainer/codes/new', { note: 'Bruno' })).body.code;
  assert.match(code, /^[0-9A-F]{16}$/);
  assert.equal((await call(STUDENT, 'POST', '/api/student/link', { code: 'NOPE' })).status, 404);
  const linked = await call(STUDENT, 'POST', '/api/student/link', { code: code.toLowerCase() });
  assert.equal(linked.status, 200);
  assert.equal(linked.body.trainer.name, 'Coach Ana');
  assert.equal((await call(OTHER, 'POST', '/api/student/link', { code })).status, 404, 'a code is single use');

  const list = (await call(TRAINER, 'GET', '/api/trainer/students')).body.students;
  assert.deepEqual(list.map(s => [s.id, s.lastWorkout]), [[STUDENT, '2026-10-10']]);

  // Another trainer sees nothing, and cannot tell the id exists.
  assert.equal((await call(OTHER, 'GET', `/api/trainer/student?id=${STUDENT}`)).status, 404);
  assert.equal((await call(OTHER, 'PUT', `/api/trainer/student?id=${STUDENT}`, { state: { routines: [] }, baseRev: 3 })).status, 404);

  const read = (await call(TRAINER, 'GET', `/api/trainer/student?id=${STUDENT}`)).body;
  assert.equal(read.rev, 3);
  assert.ok(!('coach' in read.state), 'no Coach data');
  assert.ok(!('media' in read.state.workouts[0]), 'no media refs');

  // Stale base is refused; a good one writes only the plan, stamped by the server.
  assert.equal((await call(TRAINER, 'PUT', `/api/trainer/student?id=${STUDENT}`, { state: { routines: [] } })).status, 400, 'baseRev required');
  assert.equal((await call(TRAINER, 'PUT', `/api/trainer/student?id=${STUDENT}`, { state: { routines: [] }, baseRev: 2 })).status, 409);
  const plan = { routines: [{ id: 'r1', name: 'Own' }, { id: 'rT', name: 'Treino A', ex: [{ id: '0001', sets: 3, reps: 10 }] }], week: { mon: 'rT' }, workouts: [] };
  const saved = await call(TRAINER, 'PUT', `/api/trainer/student?id=${STUDENT}`, { state: plan, baseRev: 3, baseWid: read.wid });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const S = state();
  assert.deepEqual(S.routines.map(r => r.id), ['r1', 'rT']);
  assert.equal(S.week.mon, 'rT');
  assert.equal(S.workouts.length, 1, 'history untouched by a trainer save');
  assert.ok(S._rev > 3);
  assert.ok(S.edited?.['week.mon'], 'server stamped the plan day, so the student device merge keeps it');

  // The student device reads the new revision.
  assert.equal((await call(STUDENT, 'GET', '/api/data')).body.state.week.mon, 'rT');

  // Lock: reported to the student; unlink: lock gone with it.
  assert.equal((await call(TRAINER, 'POST', '/api/trainer/student/lock', { id: STUDENT, locked: true })).body.planLocked, true);
  assert.deepEqual((await call(STUDENT, 'GET', '/api/student/trainer')).body, { trainer: { id: TRAINER, name: 'Coach Ana' }, planLocked: true });
  assert.equal((await call(STUDENT, 'POST', '/api/student/unlink')).status, 200);
  const me = (await call(STUDENT, 'GET', '/api/me')).body.user;
  assert.equal(me.trainerId, null);
  assert.equal(me.planLocked, false);
  assert.equal((await call(TRAINER, 'GET', `/api/trainer/student?id=${STUDENT}`)).status, 404);
});

test('revoking the role frees the students', async t => {
  const { call } = await startServer(t);
  await call(ADMIN, 'POST', '/api/admin/user/trainer', { id: TRAINER, trainer: true });
  const { code } = (await call(TRAINER, 'POST', '/api/trainer/codes/new', {})).body.code;
  await call(STUDENT, 'POST', '/api/student/link', { code });
  await call(TRAINER, 'POST', '/api/trainer/student/lock', { id: STUDENT, locked: true });
  await call(ADMIN, 'POST', '/api/admin/user/trainer', { id: TRAINER, trainer: false });
  const me = (await call(STUDENT, 'GET', '/api/me')).body.user;
  assert.equal(me.trainerId, null);
  assert.equal(me.planLocked, false);
});

test('on an invite-only instance a trainer code is a signup invite that links the new account', async t => {
  const { call, anon, db } = await startServer(t, { INVITE_ONLY: '1', PASSWORD_LOGIN: '1' });
  await call(ADMIN, 'POST', '/api/admin/user/trainer', { id: TRAINER, trainer: true });
  const { code } = (await call(TRAINER, 'POST', '/api/trainer/codes/new', { note: 'novo aluno' })).body.code;
  const pw = 'correct horse battery staple 42';

  assert.equal((await anon('/api/register/password', { name: 'Intruso', password: pw, code: 'DEADBEEFDEADBEEF' })).status, 403);
  // The passkey route's own check accepts it too (without burning it).
  assert.equal((await anon('/api/register/options', { name: 'Carla', code })).status, 200);
  const r = await anon('/api/register/password', { name: 'Carla', password: pw, code: code.toLowerCase() });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const carla = db().users.find(u => u.name === 'Carla');
  assert.equal(carla.trainerId, TRAINER, 'linked at signup');
  assert.equal(db().trainerCodes.find(c => c.code === code).usedBy, carla.id, 'code burned');
  assert.equal((await anon('/api/register/password', { name: 'Outra', password: pw, code })).status, 403, 'single use');
  assert.deepEqual((await call(TRAINER, 'GET', '/api/trainer/students')).body.students.map(s => s.name), ['Carla']);

  // A code of someone who is no longer a trainer opens nothing.
  const { code: c2 } = (await call(TRAINER, 'POST', '/api/trainer/codes/new', {})).body.code;
  await call(ADMIN, 'POST', '/api/admin/user/trainer', { id: TRAINER, trainer: false });
  assert.equal((await anon('/api/register/password', { name: 'Tarde', password: pw, code: c2 })).status, 403);
});
