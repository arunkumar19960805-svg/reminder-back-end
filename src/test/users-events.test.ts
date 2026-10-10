import { sequelize } from '../config/database';
import { initAssociations, User, AuditLog, ReminderInstance } from '../database/models';
import { api, createUserAndLogin, auth, isoFromNow, Actor } from './helpers';

let admin: Actor;
let alice: Actor;

beforeAll(async () => {
  initAssociations();
  await sequelize.sync({ force: true });
  admin = await createUserAndLogin({ role: 'admin', fullName: 'Admin' });
  alice = await createUserAndLogin({ role: 'user', fullName: 'Alice' });
});

afterAll(async () => {
  await sequelize.close();
});

describe('Admin user management', () => {
  it('creates a user with their own login', async () => {
    const res = await api()
      .post('/api/v1/users')
      .set(auth(admin.token))
      .send({
        email: 'newhire@test.com',
        password: 'Password@123',
        fullName: 'New Hire',
        timezone: 'Europe/London',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.email).toBe('newhire@test.com');
    expect(res.body.data.password).toBeUndefined();
    // Admin-set passwords must be changed on first login.
    expect(res.body.data.mustChangePassword).toBe(true);

    const login = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'newhire@test.com', password: 'Password@123' });
    expect(login.status).toBe(200);
  });

  it('rejects a duplicate email', async () => {
    const res = await api()
      .post('/api/v1/users')
      .set(auth(admin.token))
      .send({ email: 'newhire@test.com', password: 'Password@123', fullName: 'Clone' });
    expect(res.status).toBe(409);
  });

  it('validates the create payload', async () => {
    const res = await api()
      .post('/api/v1/users')
      .set(auth(admin.token))
      .send({ email: 'not-an-email', password: 'short', fullName: 'A' });
    expect(res.status).toBe(400);
    const fields = res.body.errors.map((e: any) => e.field);
    expect(fields).toEqual(expect.arrayContaining(['email', 'password', 'fullName']));
  });

  it('paginates and filters the user list', async () => {
    const res = await api()
      .get('/api/v1/users?page=1&limit=2&role=user')
      .set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBeLessThanOrEqual(2);
    for (const u of res.body.data.items) expect(u.role).toBe('user');
    expect(res.body.data.pagination.total).toBeGreaterThan(0);
  });

  it('updates a user', async () => {
    const res = await api()
      .patch(`/api/v1/users/${alice.id}`)
      .set(auth(admin.token))
      .send({ fullName: 'Alice Updated', timezone: 'Asia/Tokyo' });
    expect(res.status).toBe(200);
    expect(res.body.data.fullName).toBe('Alice Updated');
    expect(res.body.data.timezone).toBe('Asia/Tokyo');
  });

  it('resets a password to a temporary one and forces a change', async () => {
    const target = await createUserAndLogin({ password: 'Original@123' });

    const res = await api()
      .post(`/api/v1/users/${target.id}/reset-password`)
      .set(auth(admin.token));
    expect(res.status).toBe(200);

    const temp = res.body.data.temporaryPassword;
    expect(typeof temp).toBe('string');
    expect(temp.length).toBeGreaterThanOrEqual(10);

    // Old password no longer works; the temporary one does.
    const oldLogin = await api()
      .post('/api/v1/auth/login')
      .send({ email: target.email, password: 'Original@123' });
    expect(oldLogin.status).toBe(401);

    const newLogin = await api()
      .post('/api/v1/auth/login')
      .send({ email: target.email, password: temp });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.data.user.mustChangePassword).toBe(true);
  });

  it('reactivates a deactivated user', async () => {
    const target = await createUserAndLogin({ password: 'Password@123' });

    await api()
      .patch(`/api/v1/users/${target.id}/status`)
      .set(auth(admin.token))
      .send({ isActive: false });
    await api()
      .patch(`/api/v1/users/${target.id}/status`)
      .set(auth(admin.token))
      .send({ isActive: true });

    const login = await api()
      .post('/api/v1/auth/login')
      .send({ email: target.email, password: 'Password@123' });
    expect(login.status).toBe(200);
  });

  it('refuses to let an admin deactivate themselves', async () => {
    const res = await api()
      .patch(`/api/v1/users/${admin.id}/status`)
      .set(auth(admin.token))
      .send({ isActive: false });
    expect(res.status).toBe(400);
  });

  it('refuses to deactivate the last active admin', async () => {
    const other = await createUserAndLogin({ role: 'admin' });
    // `admin` and `other` are the two admins; deactivating `admin` via `other`
    // is fine, but then removing `other` must be blocked.
    await api()
      .patch(`/api/v1/users/${admin.id}/status`)
      .set(auth(other.token))
      .send({ isActive: false });

    const res = await api()
      .patch(`/api/v1/users/${other.id}/status`)
      .set(auth(other.token))
      .send({ isActive: false });
    expect(res.status).toBe(400);

    // Restore for later tests.
    await User.update({ isActive: true }, { where: { id: admin.id } });
  });
});

describe('Event creation and assignment', () => {
  it('assigns an event to multiple users at once', async () => {
    const u1 = await createUserAndLogin();
    const u2 = await createUserAndLogin();
    const u3 = await createUserAndLogin();

    const res = await api()
      .post('/api/v1/events')
      .set(auth(admin.token))
      .send({
        title: 'All hands',
        description: 'Company update',
        startAt: isoFromNow(240),
        endAt: isoFromNow(300),
        location: 'Auditorium',
        meetingLink: 'https://meet.example.com/all-hands',
        assigneeIds: [u1.id, u2.id, u3.id],
        reminders: [{ offsetMinutes: 30 }, { offsetMinutes: 0, isAlarm: true }],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.assignments).toHaveLength(3);
    expect(res.body.data.meetingLink).toBe('https://meet.example.com/all-hands');

    // 3 users x 2 rules
    const count = await ReminderInstance.count({ where: { eventId: res.body.data.id } });
    expect(count).toBe(6);
  });

  it('adds an assignee later and materialises their reminders', async () => {
    const u1 = await createUserAndLogin();
    const u2 = await createUserAndLogin();

    const created = await api()
      .post('/api/v1/events')
      .set(auth(admin.token))
      .send({
        title: 'Growing meeting',
        startAt: isoFromNow(240),
        assigneeIds: [u1.id],
        reminders: [{ offsetMinutes: 15 }],
      });

    const res = await api()
      .post(`/api/v1/events/${created.body.data.id}/assignments`)
      .set(auth(admin.token))
      .send({ userIds: [u2.id] });
    expect(res.status).toBe(200);

    const u2Count = await ReminderInstance.count({
      where: { eventId: created.body.data.id, userId: u2.id },
    });
    expect(u2Count).toBe(1);
  });

  it('rejects an assignment to a deactivated user', async () => {
    const target = await createUserAndLogin();
    await api()
      .patch(`/api/v1/users/${target.id}/status`)
      .set(auth(admin.token))
      .send({ isActive: false });

    const res = await api()
      .post('/api/v1/events')
      .set(auth(admin.token))
      .send({ title: 'Ghost', startAt: isoFromNow(120), assigneeIds: [target.id] });
    expect(res.status).toBe(400);
  });

  it('requires at least one assignee', async () => {
    const res = await api()
      .post('/api/v1/events')
      .set(auth(admin.token))
      .send({ title: 'Nobody', startAt: isoFromNow(120), assigneeIds: [] });
    expect(res.status).toBe(400);
  });

  it('rejects an end time before the start time', async () => {
    const res = await api()
      .post('/api/v1/events')
      .set(auth(admin.token))
      .send({
        title: 'Backwards',
        startAt: isoFromNow(120),
        endAt: isoFromNow(60),
        assigneeIds: [alice.id],
      });
    expect(res.status).toBe(400);
  });

  it('rejects a malformed meeting link', async () => {
    const res = await api()
      .post('/api/v1/events')
      .set(auth(admin.token))
      .send({
        title: 'Bad link',
        startAt: isoFromNow(120),
        assigneeIds: [alice.id],
        meetingLink: 'not a url',
      });
    expect(res.status).toBe(400);
  });

  it('exposes per-assignee delivery status to the admin', async () => {
    const u1 = await createUserAndLogin();
    const created = await api()
      .post('/api/v1/events')
      .set(auth(admin.token))
      .send({
        title: 'Status view',
        startAt: isoFromNow(180),
        assigneeIds: [u1.id],
        reminders: [{ offsetMinutes: 30 }, { offsetMinutes: 10 }],
      });

    const res = await api()
      .get(`/api/v1/events/${created.body.data.id}/status`)
      .set(auth(admin.token));

    expect(res.status).toBe(200);
    expect(res.body.data.reminders).toHaveLength(2);
    expect(res.body.data.reminders[0].user.id).toBe(u1.id);
    expect(res.body.data.reminders[0].status).toBe('pending');
  });
});

describe('Reminder rule configuration', () => {
  it('replaces the reminder ladder and rebuilds instances', async () => {
    const u1 = await createUserAndLogin();
    const created = await api()
      .post('/api/v1/events')
      .set(auth(admin.token))
      .send({
        title: 'Reconfigure',
        startAt: isoFromNow(300),
        assigneeIds: [u1.id],
        reminders: [{ offsetMinutes: 30 }],
      });
    const eventId = created.body.data.id;

    const res = await api()
      .put(`/api/v1/reminders/events/${eventId}/rules`)
      .set(auth(admin.token))
      .send({
        reminders: [
          { offsetMinutes: 60, label: '1 hour before' },
          { offsetMinutes: 0, label: 'Now', isAlarm: true },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);

    const live = await ReminderInstance.findAll({
      where: { eventId, status: 'pending' },
    });
    expect(live).toHaveLength(2);
  });

  it('cancels instances for a disabled rule', async () => {
    const u1 = await createUserAndLogin();
    const created = await api()
      .post('/api/v1/events')
      .set(auth(admin.token))
      .send({
        title: 'Disable one',
        startAt: isoFromNow(300),
        assigneeIds: [u1.id],
        reminders: [{ offsetMinutes: 45 }, { offsetMinutes: 5 }],
      });
    const eventId = created.body.data.id;

    await api()
      .put(`/api/v1/reminders/events/${eventId}/rules`)
      .set(auth(admin.token))
      .send({
        reminders: [
          { offsetMinutes: 45, isEnabled: false },
          { offsetMinutes: 5, isEnabled: true },
        ],
      });

    const pending = await ReminderInstance.findAll({
      where: { eventId, status: 'pending' },
    });
    expect(pending).toHaveLength(1);
  });
});

describe('Audit logging', () => {
  it('records sensitive operations without leaking secrets', async () => {
    const target = await createUserAndLogin();
    await api().post(`/api/v1/users/${target.id}/reset-password`).set(auth(admin.token));

    const log = await AuditLog.findOne({
      where: { action: 'user_password_reset', resourceId: target.id },
    });
    expect(log).not.toBeNull();
    expect(log!.actorId).toBe(admin.id);

    // No audit row anywhere may contain a password or token value.
    const all = await AuditLog.findAll();
    for (const entry of all) {
      const blob = JSON.stringify(entry.metadata || {});
      expect(blob).not.toMatch(/Password@123/);
      expect(blob).not.toMatch(/"password":"(?!\[redacted\])/);
    }
  });

  it('redacts a password if one is passed into metadata', async () => {
    const res = await api()
      .post('/api/v1/users')
      .set(auth(admin.token))
      .send({
        email: 'audited@test.com',
        password: 'Password@123',
        fullName: 'Audited User',
      });
    expect(res.status).toBe(201);

    const log = await AuditLog.findOne({
      where: { action: 'user_create', resourceId: res.body.data.id },
    });
    const blob = JSON.stringify(log!.metadata);
    expect(blob).not.toContain('Password@123');
  });
});
