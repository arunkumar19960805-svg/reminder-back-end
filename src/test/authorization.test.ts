import { sequelize } from '../config/database';
import { initAssociations, ReminderInstance } from '../database/models';
import { api, createUserAndLogin, auth, isoFromNow, Actor } from './helpers';

let admin: Actor;
let alice: Actor;
let bob: Actor;
let aliceEventId: string;

beforeAll(async () => {
  initAssociations();
  await sequelize.sync({ force: true });
  admin = await createUserAndLogin({ role: 'admin', fullName: 'Admin' });
  alice = await createUserAndLogin({ role: 'user', fullName: 'Alice' });
  bob = await createUserAndLogin({ role: 'user', fullName: 'Bob' });

  const res = await api()
    .post('/api/v1/events')
    .set(auth(admin.token))
    .send({
      title: 'Alice only standup',
      startAt: isoFromNow(120),
      assigneeIds: [alice.id],
      reminders: [{ offsetMinutes: 10, label: '10 min' }],
    });
  aliceEventId = res.body.data.id;
});

afterAll(async () => {
  await sequelize.close();
});

describe('Admin-only endpoints reject regular users', () => {
  // Note: a single object param keeps every case the same arity. With tuple
  // args, Jest sees an unfilled parameter as a `done` callback and hangs.
  const adminOnly = [
    { method: 'get', path: '/api/v1/users' },
    {
      method: 'post',
      path: '/api/v1/users',
      body: { email: 'x@test.com', password: 'Password@123', fullName: 'X' },
    },
    { method: 'get', path: '/api/v1/reports/dashboard' },
    { method: 'get', path: '/api/v1/reports/delivery' },
    { method: 'get', path: '/api/v1/reports/users/summary' },
  ];

  it.each(adminOnly)('$method $path is forbidden for a regular user', async (testCase) => {
    const { method, path, body } = testCase as {
      method: string;
      path: string;
      body?: Record<string, unknown>;
    };
    const req = (api() as any)[method](path).set(auth(alice.token));
    const res = await (body ? req.send(body) : req);
    expect(res.status).toBe(403);
  });

  it('refuses event creation by a regular user', async () => {
    const res = await api()
      .post('/api/v1/events')
      .set(auth(alice.token))
      .send({ title: 'Sneaky', startAt: isoFromNow(60), assigneeIds: [alice.id] });
    expect(res.status).toBe(403);
  });

  it('refuses event cancellation by a regular user', async () => {
    const res = await api()
      .post(`/api/v1/events/${aliceEventId}/cancel`)
      .set(auth(alice.token))
      .send({ reason: 'nope' });
    expect(res.status).toBe(403);
  });

  it('refuses reminder-rule configuration by a regular user', async () => {
    const res = await api()
      .put(`/api/v1/reminders/events/${aliceEventId}/rules`)
      .set(auth(alice.token))
      .send({ reminders: [{ offsetMinutes: 1 }] });
    expect(res.status).toBe(403);
  });
});

describe('User data isolation', () => {
  it("hides another user's event from the list", async () => {
    const res = await api().get('/api/v1/events').set(auth(bob.token));
    expect(res.status).toBe(200);
    const ids = res.body.data.items.map((e: any) => e.id);
    expect(ids).not.toContain(aliceEventId);
  });

  it("returns 404 when a user opens another user's event directly", async () => {
    const res = await api().get(`/api/v1/events/${aliceEventId}`).set(auth(bob.token));
    expect(res.status).toBe(404);
  });

  it('lets the assigned user read their own event', async () => {
    const res = await api().get(`/api/v1/events/${aliceEventId}`).set(auth(alice.token));
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Alice only standup');
  });

  it("never lists another user's reminders", async () => {
    const res = await api().get('/api/v1/reminders?scope=all').set(auth(bob.token));
    expect(res.status).toBe(200);
    for (const item of res.body.data.items) {
      expect(item.userId).toBe(bob.id);
    }
  });

  it("returns 404 when a user opens another user's reminder", async () => {
    const aliceReminder = await ReminderInstance.findOne({ where: { userId: alice.id } });
    expect(aliceReminder).not.toBeNull();

    const res = await api()
      .get(`/api/v1/reminders/${aliceReminder!.id}`)
      .set(auth(bob.token));
    expect(res.status).toBe(404);
  });

  it("refuses to let a user acknowledge another user's reminder", async () => {
    const aliceReminder = await ReminderInstance.findOne({ where: { userId: alice.id } });

    const res = await api()
      .post(`/api/v1/reminders/${aliceReminder!.id}/acknowledge`)
      .set(auth(bob.token))
      .send({});
    expect(res.status).toBe(404);

    // And the reminder must be untouched.
    await aliceReminder!.reload();
    expect(aliceReminder!.status).not.toBe('acknowledged');
  });

  it("scopes acknowledgement history to the requesting user", async () => {
    const res = await api().get('/api/v1/reminders/history').set(auth(bob.token));
    expect(res.status).toBe(200);
    for (const item of res.body.data.items) {
      expect(item.userId).toBe(bob.id);
    }
  });

  it('lets an admin see any event', async () => {
    const res = await api().get(`/api/v1/events/${aliceEventId}`).set(auth(admin.token));
    expect(res.status).toBe(200);
  });
});

describe('Device token ownership', () => {
  it('binds a registered token to the authenticated user and masks it in responses', async () => {
    const token = `tok_${'a'.repeat(40)}`;
    const res = await api()
      .post('/api/v1/devices')
      .set(auth(alice.token))
      .send({ fcmToken: token, platform: 'android', deviceName: "Alice's Pixel" });

    expect(res.status).toBe(201);
    expect(res.body.data.userId).toBe(alice.id);
    // The raw token must never come back out of the API.
    expect(res.body.data.fcmToken).toBeUndefined();
    expect(res.body.data.fcmTokenPreview).toBe('...aaaaaa');
  });

  it("re-points a token to the new owner when a device changes hands", async () => {
    const shared = `tok_${'b'.repeat(40)}`;
    await api().post('/api/v1/devices').set(auth(alice.token)).send({ fcmToken: shared });
    const res = await api().post('/api/v1/devices').set(auth(bob.token)).send({ fcmToken: shared });

    expect(res.status).toBe(201);
    expect(res.body.data.userId).toBe(bob.id);

    // Alice must no longer own it, or she would receive Bob's reminders.
    const aliceDevices = await api().get('/api/v1/devices').set(auth(alice.token));
    const stillHasIt = aliceDevices.body.data.some(
      (d: any) => d.fcmTokenPreview === '...bbbbbb'
    );
    expect(stillHasIt).toBe(false);
  });

  it("refuses to deactivate another user's device", async () => {
    const reg = await api()
      .post('/api/v1/devices')
      .set(auth(alice.token))
      .send({ fcmToken: `tok_${'c'.repeat(40)}` });

    const res = await api().delete(`/api/v1/devices/${reg.body.data.id}`).set(auth(bob.token));
    expect(res.status).toBe(404);
  });
});
