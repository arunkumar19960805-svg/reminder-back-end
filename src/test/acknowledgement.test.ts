import { sequelize } from '../config/database';
import {
  initAssociations,
  ReminderInstance,
  Acknowledgement,
  Device,
} from '../database/models';
import { api, createUserAndLogin, auth, isoFromNow, Actor } from './helpers';
import { runSchedulerTick } from '../workers/reminder.worker';
import * as pushService from '../services/push.service';

let admin: Actor;
let alice: Actor;

const createEvent = async (body: Record<string, unknown>) => {
  const res = await api().post('/api/v1/events').set(auth(admin.token)).send(body);
  if (res.status !== 201) {
    throw new Error(`createEvent failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data;
};

beforeAll(async () => {
  initAssociations();
  await sequelize.sync({ force: true });
  admin = await createUserAndLogin({ role: 'admin', fullName: 'Admin' });
  alice = await createUserAndLogin({ role: 'user', fullName: 'Alice' });
});

afterAll(async () => {
  await sequelize.close();
});

describe('Acknowledging a reminder', () => {
  it('records the acknowledgement and flips the status', async () => {
    const event = await createEvent({
      title: 'Ack me',
      startAt: isoFromNow(60),
      assigneeIds: [alice.id],
      reminders: [{ offsetMinutes: 30 }],
    });

    const reminder = await ReminderInstance.findOne({ where: { eventId: event.id } });

    const res = await api()
      .post(`/api/v1/reminders/${reminder!.id}/acknowledge`)
      .set(auth(alice.token))
      .send({ source: 'app' });

    expect(res.status).toBe(200);
    expect(res.body.data.alreadyAcknowledged).toBe(false);
    expect(res.body.data.acknowledgement.acknowledgedAt).toBeDefined();

    await reminder!.reload();
    expect(reminder!.status).toBe('acknowledged');
  });

  it('is idempotent when acknowledged twice', async () => {
    const event = await createEvent({
      title: 'Double ack',
      startAt: isoFromNow(60),
      assigneeIds: [alice.id],
      reminders: [{ offsetMinutes: 25 }],
    });
    const reminder = await ReminderInstance.findOne({ where: { eventId: event.id } });

    const first = await api()
      .post(`/api/v1/reminders/${reminder!.id}/acknowledge`)
      .set(auth(alice.token))
      .send({});
    const second = await api()
      .post(`/api/v1/reminders/${reminder!.id}/acknowledge`)
      .set(auth(alice.token))
      .send({});

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.data.alreadyAcknowledged).toBe(true);

    // Exactly one audit row, not two.
    const count = await Acknowledgement.count({ where: { reminderInstanceId: reminder!.id } });
    expect(count).toBe(1);
  });

  it('produces a single acknowledgement under concurrent requests', async () => {
    const event = await createEvent({
      title: 'Race ack',
      startAt: isoFromNow(60),
      assigneeIds: [alice.id],
      reminders: [{ offsetMinutes: 22 }],
    });
    const reminder = await ReminderInstance.findOne({ where: { eventId: event.id } });

    const results = await Promise.all([
      api().post(`/api/v1/reminders/${reminder!.id}/acknowledge`).set(auth(alice.token)).send({}),
      api().post(`/api/v1/reminders/${reminder!.id}/acknowledge`).set(auth(alice.token)).send({}),
      api().post(`/api/v1/reminders/${reminder!.id}/acknowledge`).set(auth(alice.token)).send({}),
    ]);

    for (const r of results) expect(r.status).toBe(200);
    const count = await Acknowledgement.count({ where: { reminderInstanceId: reminder!.id } });
    expect(count).toBe(1);
  });

  it('silences the remaining reminders for the same occurrence', async () => {
    const event = await createEvent({
      title: 'Ladder',
      startAt: isoFromNow(60),
      assigneeIds: [alice.id],
      reminders: [
        { offsetMinutes: 30 },
        { offsetMinutes: 10 },
        { offsetMinutes: 5 },
        { offsetMinutes: 0, isAlarm: true },
      ],
    });

    const all = await ReminderInstance.findAll({
      where: { eventId: event.id },
      order: [['scheduledAt', 'ASC']],
    });
    expect(all).toHaveLength(4);

    // Acknowledge the earliest one.
    await api()
      .post(`/api/v1/reminders/${all[0].id}/acknowledge`)
      .set(auth(alice.token))
      .send({});

    const after = await ReminderInstance.findAll({ where: { eventId: event.id } });
    // Every later reminder in the ladder is silenced too.
    for (const r of after) {
      expect(r.status).toBe('acknowledged');
    }
  });

  it('stops the alarm: an acknowledged reminder is never sent by the scheduler', async () => {
    const victim = await createUserAndLogin();
    const device = await Device.create({
      userId: victim.id,
      fcmToken: `tok_ackstop_${'q'.repeat(28)}`,
      platform: 'android',
    });

    const event = await createEvent({
      title: 'Acked before firing',
      startAt: isoFromNow(1),
      assigneeIds: [victim.id],
      reminders: [{ offsetMinutes: 1, isAlarm: true }],
    });

    const reminder = await ReminderInstance.findOne({ where: { eventId: event.id } });
    await api()
      .post(`/api/v1/reminders/${reminder!.id}/acknowledge`)
      .set(auth(victim.token))
      .send({});

    const sendSpy = jest
      .spyOn(pushService, 'sendReminderToUserDevices')
      .mockResolvedValue([
        { deviceId: device.id, status: 'accepted', providerMessageId: 'should-not-happen' },
      ] as any);

    await runSchedulerTick();

    expect(sendSpy).not.toHaveBeenCalled();
    await reminder!.reload();
    expect(reminder!.status).toBe('acknowledged');
    sendSpy.mockRestore();
  });

  it('refuses to acknowledge a cancelled reminder', async () => {
    const event = await createEvent({
      title: 'Cancelled ack',
      startAt: isoFromNow(60),
      assigneeIds: [alice.id],
      reminders: [{ offsetMinutes: 18 }],
    });
    const reminder = await ReminderInstance.findOne({ where: { eventId: event.id } });
    await api().post(`/api/v1/events/${event.id}/cancel`).set(auth(admin.token)).send({});

    const res = await api()
      .post(`/api/v1/reminders/${reminder!.id}/acknowledge`)
      .set(auth(alice.token))
      .send({});
    expect(res.status).toBe(409);
  });

  it('appears in the user’s acknowledgement history', async () => {
    const res = await api().get('/api/v1/reminders/history').set(auth(alice.token));
    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBeGreaterThan(0);
    expect(res.body.data.pagination.total).toBeGreaterThan(0);
  });
});

describe('Multi-device acknowledgement sync', () => {
  it('pushes a sync message to the user’s other devices', async () => {
    const victim = await createUserAndLogin();
    const phone = await Device.create({
      userId: victim.id,
      fcmToken: `tok_phone_${'m'.repeat(30)}`,
      platform: 'android',
      deviceName: 'Phone',
    });
    const tablet = await Device.create({
      userId: victim.id,
      fcmToken: `tok_tablet_${'n'.repeat(29)}`,
      platform: 'android',
      deviceName: 'Tablet',
    });

    const event = await createEvent({
      title: 'Two devices',
      startAt: isoFromNow(60),
      assigneeIds: [victim.id],
      reminders: [{ offsetMinutes: 15 }],
    });
    const reminder = await ReminderInstance.findOne({ where: { eventId: event.id } });

    const syncSpy = jest
      .spyOn(pushService, 'sendAcknowledgementSync')
      .mockResolvedValue(undefined);

    // Acknowledge from the phone.
    const res = await api()
      .post(`/api/v1/reminders/${reminder!.id}/acknowledge`)
      .set(auth(victim.token))
      .send({ deviceId: phone.id, source: 'notification_action' });
    expect(res.status).toBe(200);

    expect(syncSpy).toHaveBeenCalledTimes(1);
    const [devicesArg, reminderIdArg] = syncSpy.mock.calls[0];

    // The acknowledging device is excluded; the tablet is told to stop.
    const ids = (devicesArg as Device[]).map((d) => d.id);
    expect(ids).toContain(tablet.id);
    expect(ids).not.toContain(phone.id);
    expect(reminderIdArg).toBe(reminder!.id);

    syncSpy.mockRestore();
  });

  it('records which device acknowledged', async () => {
    const victim = await createUserAndLogin();
    const device = await Device.create({
      userId: victim.id,
      fcmToken: `tok_which_${'p'.repeat(30)}`,
      platform: 'android',
    });

    const event = await createEvent({
      title: 'Device attribution',
      startAt: isoFromNow(60),
      assigneeIds: [victim.id],
      reminders: [{ offsetMinutes: 12 }],
    });
    const reminder = await ReminderInstance.findOne({ where: { eventId: event.id } });

    jest.spyOn(pushService, 'sendAcknowledgementSync').mockResolvedValue(undefined);

    await api()
      .post(`/api/v1/reminders/${reminder!.id}/acknowledge`)
      .set(auth(victim.token))
      .send({ deviceId: device.id, source: 'notification_action' });

    const ack = await Acknowledgement.findOne({ where: { reminderInstanceId: reminder!.id } });
    expect(ack!.deviceId).toBe(device.id);
    expect(ack!.source).toBe('notification_action');
  });
});

describe('Reminder scopes for the user dashboard', () => {
  it('separates upcoming, overdue and acknowledged', async () => {
    const victim = await createUserAndLogin();

    // Upcoming.
    await createEvent({
      title: 'Future',
      startAt: isoFromNow(600),
      assigneeIds: [victim.id],
      reminders: [{ offsetMinutes: 30 }],
    });

    // Overdue: delivered but never acknowledged.
    const overdueEvent = await createEvent({
      title: 'Overdue',
      startAt: isoFromNow(90),
      assigneeIds: [victim.id],
      reminders: [{ offsetMinutes: 20 }],
    });
    await ReminderInstance.update(
      { status: 'sent', scheduledAt: new Date(Date.now() - 10 * 60_000), sentAt: new Date() },
      { where: { eventId: overdueEvent.id } }
    );

    const upcoming = await api()
      .get('/api/v1/reminders?scope=upcoming')
      .set(auth(victim.token));
    const overdue = await api().get('/api/v1/reminders?scope=overdue').set(auth(victim.token));

    expect(upcoming.status).toBe(200);
    expect(upcoming.body.data.items.length).toBeGreaterThan(0);
    for (const i of upcoming.body.data.items) {
      expect(new Date(i.scheduledAt).getTime()).toBeGreaterThan(Date.now());
    }

    expect(overdue.body.data.items.length).toBeGreaterThan(0);
    for (const i of overdue.body.data.items) {
      expect(['sent', 'failed']).toContain(i.status);
    }
  });

  it('paginates reminder history', async () => {
    const res = await api()
      .get('/api/v1/reminders?scope=all&page=1&limit=2')
      .set(auth(alice.token));
    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBeLessThanOrEqual(2);
    expect(res.body.data.pagination.limit).toBe(2);
    expect(res.body.data.pagination.page).toBe(1);
  });
});
