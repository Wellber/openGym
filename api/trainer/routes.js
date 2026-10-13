/* HTTP surface for personal trainer mode (docs/dev/PERSONAL_TRAINER.md).
 *
 * A factory over server.js's own helpers, the way coach/routes.js is: they close over db.json
 * and the state files, and passing them in keeps this module free of a cycle.
 */
import { manages, studentsOf, studentView, applyPlan, newCode, isTrainer } from './core.js';

export function trainerRoutes({
  json, readBody, readSession, requireAdmin, audit, getDb, saveDb, text,
  readStateStrict, UNREADABLE, commitState, randomHex, lastSyncOf
}) {
  const idParam = req => new URL(req.url, 'http://x').searchParams.get('id') || '';
  const codes = () => { const db = getDb(); return (db.trainerCodes = db.trainerCodes || []); };

  /** Signed in and a trainer, or answered (401/403) and null. */
  const asTrainer = (req, res) => {
    const user = readSession(req);
    if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
    if (!isTrainer(user)) { json(res, 403, { error: 'not a trainer' }); return null; }
    return user;
  };
  /** The trainer and their student, or answered and null. A student of someone else is a 404, not
   *  a 403: which ids exist on the instance is no business of another trainer. */
  const asTrainerOf = (req, res, id) => {
    const trainer = asTrainer(req, res); if (!trainer) return null;
    if (!manages(getDb(), trainer, id)) { json(res, 404, { error: 'no such student' }); return null; }
    return { trainer, student: getDb().users.find(u => u.id === id) };
  };
  const unlink = s => { delete s.trainerId; delete s.planLocked; };

  return {
    'POST /api/admin/user/trainer': async (req, res) => {
      const admin = requireAdmin(req, res); if (!admin) return;
      const body = await readBody(req);
      const db = getDb();
      const u = db.users.find(x => x.id === body.id);
      if (!u) return json(res, 404, { error: 'no such user' });
      if (body.trainer) u.trainer = true;
      else {
        delete u.trainer;
        // Students left without a trainer get their plan back, and unused codes stop working.
        for (const s of studentsOf(db, u)) unlink(s);
        db.trainerCodes = codes().filter(c => c.trainerId !== u.id || c.usedBy);
      }
      saveDb();
      audit(req, body.trainer ? 'admin.trainer.grant' : 'admin.trainer.revoke', { user: admin, target: u });
      json(res, 200, { ok: true, id: u.id, trainer: !!u.trainer });
    },

    'GET /api/trainer/students': async (req, res) => {
      const trainer = asTrainer(req, res); if (!trainer) return;
      const students = studentsOf(getDb(), trainer).map(s => {
        const S = readStateStrict(s.id);
        const doc = S && S !== UNREADABLE ? S : null;
        return {
          id: s.id, name: s.name, planLocked: !!s.planLocked, disabled: !!s.disabled,
          lastSync: lastSyncOf(s, doc),
          lastWorkout: Array.isArray(doc?.workouts) && doc.workouts.length ? doc.workouts[doc.workouts.length - 1]?.d || null : null
        };
      });
      json(res, 200, { students });
    },

    'GET /api/trainer/codes': async (req, res) => {
      const trainer = asTrainer(req, res); if (!trainer) return;
      const db = getDb();
      json(res, 200, {
        codes: codes().filter(c => c.trainerId === trainer.id).map(c => ({
          ...c, usedByName: c.usedBy ? db.users.find(u => u.id === c.usedBy)?.name || null : null
        }))
      });
    },

    'POST /api/trainer/codes/new': async (req, res) => {
      const trainer = asTrainer(req, res); if (!trainer) return;
      const body = await readBody(req);
      const code = newCode(randomHex, c => codes().some(x => x.code === c));
      const entry = { code, trainerId: trainer.id, note: text(body.note).slice(0, 60), created: new Date().toISOString(), usedBy: null };
      codes().push(entry);
      saveDb();
      audit(req, 'trainer.code.create', { user: trainer, msg: code });
      json(res, 200, { code: entry });
    },

    'POST /api/trainer/codes/revoke': async (req, res) => {
      const trainer = asTrainer(req, res); if (!trainer) return;
      const body = await readBody(req);
      const c = codes().find(x => x.code === text(body.code).toUpperCase() && x.trainerId === trainer.id);
      if (!c) return json(res, 404, { error: 'no such code' });
      if (c.usedBy) return json(res, 400, { error: 'already used, cannot revoke' });
      getDb().trainerCodes = codes().filter(x => x !== c);
      saveDb();
      json(res, 200, { ok: true });
    },

    'GET /api/trainer/student': async (req, res) => {
      const id = idParam(req);
      const ctx = asTrainerOf(req, res, id); if (!ctx) return;
      const S = readStateStrict(id);
      if (S === UNREADABLE) return json(res, 503, { error: 'state unreadable' });
      json(res, 200, {
        student: { id, name: ctx.student.name, planLocked: !!ctx.student.planLocked },
        state: studentView(S), rev: S?._rev || 0, ...(S?._wid ? { wid: S._wid } : {})
      });
    },

    // Same compare-and-write as PUT /api/data: a `baseRev`/`baseWid` that is not the stored
    // document is a 409 carrying the current view, so the trainer's screen can reload and redo.
    // `baseRev` is required here — a trainer never overwrites blind.
    'PUT /api/trainer/student': async (req, res) => {
      const id = idParam(req);
      const ctx = asTrainerOf(req, res, id); if (!ctx) return;
      const body = await readBody(req);
      if (!body.state || typeof body.state !== 'object' || Array.isArray(body.state)) return json(res, 400, { error: 'state required' });
      if (body.state.routines != null && !Array.isArray(body.state.routines)) return json(res, 400, { error: 'invalid state' });
      if (typeof body.baseRev !== 'number') return json(res, 400, { error: 'baseRev required' });
      const cur = readStateStrict(id);
      if (cur === UNREADABLE) return json(res, 503, { error: 'state unreadable' });
      const curRev = cur?._rev || 0;
      if (body.baseRev !== curRev || (typeof body.baseWid === 'string' && cur?._wid && body.baseWid !== cur._wid)) {
        return json(res, 409, { error: 'conflict', rev: curRev, state: studentView(cur) });
      }
      const next = applyPlan(cur, body.state);
      const out = commitState(id, cur, next, { overRead: true, stamped: false });
      if (out.status === 200) audit(req, 'trainer.plan.save', { user: ctx.trainer, target: ctx.student });
      json(res, out.status, out.body);
    },

    'POST /api/trainer/student/lock': async (req, res) => {
      const body = await readBody(req);
      const ctx = asTrainerOf(req, res, text(body.id)); if (!ctx) return;
      if (body.locked) ctx.student.planLocked = true; else delete ctx.student.planLocked;
      saveDb();
      json(res, 200, { ok: true, id: ctx.student.id, planLocked: !!ctx.student.planLocked });
    },

    'POST /api/trainer/student/unlink': async (req, res) => {
      const body = await readBody(req);
      const ctx = asTrainerOf(req, res, text(body.id)); if (!ctx) return;
      unlink(ctx.student);
      saveDb();
      audit(req, 'trainer.unlink', { user: ctx.trainer, target: ctx.student });
      json(res, 200, { ok: true });
    },

    'GET /api/student/trainer': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'not signed in' });
      const t = user.trainerId ? getDb().users.find(u => u.id === user.trainerId) : null;
      json(res, 200, { trainer: t ? { id: t.id, name: t.name } : null, planLocked: !!(t && user.planLocked) });
    },

    'POST /api/student/link': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'not signed in' });
      const body = await readBody(req);
      const c = codes().find(x => x.code === text(body.code).trim().toUpperCase() && !x.usedBy);
      const t = c && getDb().users.find(u => u.id === c.trainerId);
      if (!c || !isTrainer(t)) return json(res, 404, { error: 'invalid code' });
      if (t.id === user.id) return json(res, 400, { error: 'a trainer cannot be their own student' });
      if (user.trainerId && user.trainerId !== t.id) return json(res, 409, { error: 'already linked to a trainer, unlink first' });
      user.trainerId = t.id;
      c.usedBy = user.id; c.usedAt = new Date().toISOString();
      saveDb();
      audit(req, 'student.link', { user, target: t });
      json(res, 200, { ok: true, trainer: { id: t.id, name: t.name } });
    },

    'POST /api/student/unlink': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'not signed in' });
      unlink(user);
      saveDb();
      audit(req, 'student.unlink', { user });
      json(res, 200, { ok: true });
    }
  };
}
