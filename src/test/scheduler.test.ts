import { Op } from 'sequelize';
import { sequelize } from '../config/database';
import {
  initAssociations,
  ReminderInstance,
  ReminderRule,
  Event,
  EventAssignment,
  Device,
  NotificationAttempt,
} from '../database/models';
import { api, createUserAndLogin, auth, isoFromNow, Actor } from './helpers';
import {
  materializeEventReminders,
  rebuildEventReminders,
} from '../services/reminder-materializer.service';
import { expandOccurrences } from '../services/recurrence.service';
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

describe('Multiple reminders per event', () => {
  it('creates one independently scheduled instance per rule per assignee', async () => {
    const bob = await createUserAndLogin();
    const event = await createEvent({
      title: 'Quarterly review',
      startAt: isoFromNow(120),
      assigneeIds: [alice.id, bob.id],
      reminders: [
        { offsetMinutes: 30, label: '30 minutes before' },
        { offsetMinutes: 10, label: '10 minutes before' },
        { offsetMinutes: 5, label: '5 minutes before' },
        { offsetMinutes: 0, label: 'Starting now', isAlarm: true },
      ],
    });

    const instances = await ReminderInstance.findAll({ where: { eventId: event.id } });
    // 4 rules x 2 assignees
    expect(instances).toHaveLength(8);

    const aliceOnes = instances.filter((i) => i.userId === alice.id);
    expect(aliceOnes).toHaveLength(4);

    // Each has its own distinct absolute fire time.
    const times = aliceOnes.map((i) => i.scheduledAt.getTime()).sort();
    expect(new Set(times).size).toBe(4);

    // The 0-offset one is flagged as an alarm; the others are not.
    const alarms = aliceOnes.filter((i) => i.isAlarm);
    expect(alarms).toHaveLength(1);
  });

  it('applies a sensible default ladder when none is supplied', async () => {
    const event = await createEvent({
      title: 'Default reminders',
      startAt: isoFromNow(240),
      assigneeIds: [alice.id],
    });
    const rules = await ReminderRule.findAll({ where: { eventId: event.id } });
    expect(rules.map((r) => r.offsetMinutes).sort((a, b) => b - a)).toEqual([30, 10, 5, 0]);
  });

  it('rejects duplicate offsets on the same event', async () => {
    const res = await api()
      .post('/api/v1/events')
      .set(auth(admin.token))
      .send({
        title: 'Dup offsets',
        startAt: isoFromNow(120),
        assigneeIds: [alice.id],
        reminders: [{ offsetMinutes: 10 }, { offsetMinutes: 10 }],
      });
    expect(res.status).toBe(400);
  });
});

describe('Duplicate-delivery prevention', () => {
  it('is idempotent when materialisation runs repeatedly', async () => {
    const event = await createEvent({
      title: 'Idempotent',
      startAt: isoFromNow(120),
      assigneeIds: [alice.id],
      reminders: [{ offsetMinutes: 15 }],
    });

    const before = await ReminderInstance.count({ where: { eventId: event.id } });
    await materializeEventReminders(event.id);
    await materializeEventReminders(event.id);
    await materializeEventReminders(event.id);
    const after = await ReminderInstance.count({ where: { eventId: event.id } });

    expect(after).toBe(before);
  });

  it('survives concurrent materialisation without creating duplicates', async () => {
    const event = await createEvent({
      title: 'Concurrent',
      startAt: isoFromNow(180),
      assigneeIds: [alice.id],
      reminders: [{ offsetMinutes: 20 }],
    });

    await Promise.all([
      materializeEventReminders(event.id),
      materializeEventReminders(event.id),
      materializeEventReminders(event.id),
      materializeEventReminders(event.id),
    ]);

    expect(await ReminderInstance.count({ where: { eventId: event.id } })).toBe(1);
  });

  it('enforces the dedupe constraint at the database level', async () => {
    const event = await createEvent({
      title: 'DB constraint',
      startAt: isoFromNow(200),
      assigneeIds: [alice.id],
      reminders: [{ offsetMinutes: 25 }],
    });

    const existing = await ReminderInstance.findOne({ where: { eventId: event.id } });
    expect(existing).not.toBeNull();

    // A raw insert bypassing the service must still be refused.
    await expect(
      ReminderInstance.create({
        eventId: existing!.eventId,
        assignmentId: existing!.assignmentId,
        ruleId: existing!.ruleId,
        userId: existing!.userId,
        occurrenceStart: existing!.occurrenceStart,
        scheduledAt: existing!.scheduledAt,
        status: 'pending',
      })
    ).rejects.toThrow();
  });

  it('claims each due reminder exactly once across concurrent scheduler ticks', async () => {
    const victim = await createUserAndLogin();
    const device = await Device.create({
      userId: victim.id,
      fcmToken: `tok_concurrent_${'z'.repeat(30)}`,
      platform: 'android',
    });

    // Due immediately.
    await createEvent({
      title: 'Race',
      startAt: isoFromNow(1),
      assigneeIds: [victim.id],
      reminders: [{ offsetMinutes: 1 }],
    });

    const sendSpy = jest
      .spyOn(pushService, 'sendReminderToUserDevices')
      .mockResolvedValue([
        { deviceId: device.id, status: 'accepted', providerMessageId: 'mock-1' },
      ] as any);

    // Two "instances" polling at the same moment.
    await Promise.all([runSchedulerTick(), runSchedulerTick(), runSchedulerTick()]);

    // Exactly one send, despite three concurrent pollers.
    expect(sendSpy).toHaveBeenCalledTimes(1);
    sendSpy.mockRestore();
  });
});

describe('Timezone and DST handling', () => {
  it('stores times in UTC regardless of the submitted offset', async () => {
    const event = await createEvent({
      title: 'TZ check',
      // 09:00 in India == 03:30 UTC
      startAt: '2027-03-15T09:00:00+05:30',
      timezone: 'Asia/Kolkata',
      assigneeIds: [alice.id],
      reminders: [{ offsetMinutes: 30 }],
    });

    const row = await Event.findByPk(event.id);
    expect(row!.startAt.toISOString()).toBe('2027-03-15T03:30:00.000Z');
    expect(row!.timezone).toBe('Asia/Kolkata');
  });

  it('keeps the wall-clock hour stable across a DST transition', () => {
    // US DST begins 2027-03-14. A daily 09:00 New York meeting must stay 09:00
    // local, which means its UTC instant shifts by an hour.
    const occurrences = expandOccurrences(
      {
        startAt: new Date('2027-03-12T14:00:00.000Z'), // 09:00 America/New_York (EST, UTC-5)
        timezone: 'America/New_York',
        recurrenceFrequency: 'daily',
        recurrenceInterval: 1,
        recurrenceDaysOfWeek: null,
        recurrenceEndAt: null,
      } as any,
      new Date('2027-03-11T00:00:00.000Z'),
      new Date('2027-03-18T00:00:00.000Z')
    );

    const iso = occurrences.map((d) => d.toISOString());
    // Before the switch: 14:00Z. After: 13:00Z — same 09:00 local.
    expect(iso).toContain('2027-03-12T14:00:00.000Z');
    expect(iso).toContain('2027-03-16T13:00:00.000Z');
  });

  it('rejects an unknown timezone', async () => {
    const res = await api()
      .post('/api/v1/events')
      .set(auth(admin.token))
      .send({
        title: 'Bad tz',
        startAt: isoFromNow(60),
        timezone: 'Mars/Olympus_Mons',
        assigneeIds: [alice.id],
      });
    expect(res.status).toBe(400);
  });

  it('computes reminder offsets as absolute instants', async () => {
    const event = await createEvent({
      title: 'Offset math',
      startAt: isoFromNow(120),
      assigneeIds: [alice.id],
      reminders: [{ offsetMinutes: 45 }],
    });

    const row = await Event.findByPk(event.id);
    const instance = await ReminderInstance.findOne({ where: { eventId: event.id } });
    const delta = row!.startAt.getTime() - instance!.scheduledAt.getTime();
    expect(delta).toBe(45 * 60_000);
  });
});

describe('Recurring events', () => {
  it('materialises multiple occurrences for a daily series', async () => {
    const event = await createEvent({
      title: 'Daily standup',
      startAt: isoFromNow(60),
      assigneeIds: [alice.id],
      recurrenceFrequency: 'daily',
      recurrenceInterval: 1,
      reminders: [{ offsetMinutes: 10 }],
    });

    const instances = await ReminderInstance.findAll({ where: { eventId: event.id } });
    // Horizon is 30 days, so there should be many distinct occurrences.
    expect(instances.length).toBeGreaterThan(20);
    const occurrences = new Set(instances.map((i) => i.occurrenceStart.toISOString()));
    expect(occurrences.size).toBe(instances.length);
  });

  it('honours a recurrence end date', async () => {
    const start = new Date(Date.now() + 60 * 60_000);
    const end = new Date(start.getTime() + 3 * 24 * 60 * 60_000);

    const event = await createEvent({
      title: 'Bounded series',
      startAt: start.toISOString(),
      assigneeIds: [alice.id],
      recurrenceFrequency: 'daily',
      recurrenceEndAt: end.toISOString(),
      reminders: [{ offsetMinutes: 5 }],
    });

    const instances = await ReminderInstance.findAll({ where: { eventId: event.id } });
    expect(instances.length).toBeLessThanOrEqual(4);
    for (const i of instances) {
      expect(i.occurrenceStart.getTime()).toBeLessThanOrEqual(end.getTime());
    }
  });

  it('does not duplicate occurrences when the horizon is extended again', async () => {
    const event = await createEvent({
      title: 'Horizon rerun',
      startAt: isoFromNow(90),
      assigneeIds: [alice.id],
      recurrenceFrequency: 'weekly',
      reminders: [{ offsetMinutes: 15 }],
    });

    const first = await ReminderInstance.count({ where: { eventId: event.id } });
    await materializeEventReminders(event.id);
    const second = await ReminderInstance.count({ where: { eventId: event.id } });
    expect(second).toBe(first);
  });
});

describe('Rescheduling and cancellation', () => {
  it('cancels outstanding reminders and rebuilds them on reschedule', async () => {
    const event = await createEvent({
      title: 'Reschedule me',
      startAt: isoFromNow(180),
      assigneeIds: [alice.id],
      reminders: [{ offsetMinutes: 30 }],
    });

    const original = await ReminderInstance.findOne({ where: { eventId: event.id } });
    const originalTime = original!.scheduledAt.getTime();

    const res = await api()
      .patch(`/api/v1/events/${event.id}`)
      .set(auth(admin.token))
      .send({ startAt: isoFromNow(300) });
    expect(res.status).toBe(200);

    await original!.reload();
    expect(original!.status).toBe('cancelled');

    const live = await ReminderInstance.findOne({
      where: { eventId: event.id, status: 'pending' },
    });
    expect(live).not.toBeNull();
    expect(live!.scheduledAt.getTime()).toBeGreaterThan(originalTime);
  });

  it('cancels all pending reminders when an event is cancelled', async () => {
    const event = await createEvent({
      title: 'Cancel me',
      startAt: isoFromNow(120),
      assigneeIds: [alice.id],
      reminders: [{ offsetMinutes: 30 }, { offsetMinutes: 10 }],
    });

    const res = await api()
      .post(`/api/v1/events/${event.id}/cancel`)
      .set(auth(admin.token))
      .send({ reason: 'Room unavailable' });
    expect(res.status).toBe(200);

    const remaining = await ReminderInstance.count({
      where: { eventId: event.id, status: { [Op.in]: ['pending', 'processing'] } },
    });
    expect(remaining).toBe(0);
  });

  it('never creates new reminders for a cancelled event', async () => {
    const event = await createEvent({
      title: 'Stays cancelled',
      startAt: isoFromNow(120),
      assigneeIds: [alice.id],
      reminders: [{ offsetMinutes: 30 }],
    });
    await api().post(`/api/v1/events/${event.id}/cancel`).set(auth(admin.token)).send({});

    const { created } = await materializeEventReminders(event.id);
    expect(created).toBe(0);

    const pending = await ReminderInstance.count({
      where: { eventId: event.id, status: 'pending' },
    });
    expect(pending).toBe(0);
  });

  it('drops a reminder whose event was cancelled after it was claimed', async () => {
    const victim = await createUserAndLogin();
    await Device.create({
      userId: victim.id,
      fcmToken: `tok_cancelled_${'y'.repeat(28)}`,
      platform: 'android',
    });

    const event = await createEvent({
      title: 'Cancelled mid-flight',
      startAt: isoFromNow(1),
      assigneeIds: [victim.id],
      reminders: [{ offsetMinutes: 1 }],
    });

    // Cancel directly in the DB so the pending rows survive to the tick.
    await Event.update({ status: 'cancelled' }, { where: { id: event.id } });

    const sendSpy = jest.spyOn(pushService, 'sendReminderToUserDevices');
    await runSchedulerTick();

    expect(sendSpy).not.toHaveBeenCalled();
    const row = await ReminderInstance.findOne({ where: { eventId: event.id } });
    expect(row!.status).toBe('cancelled');
    sendSpy.mockRestore();
  });

  it('cancels only the unassigned user’s reminders', async () => {
    const carol = await createUserAndLogin();
    const event = await createEvent({
      title: 'Partial unassign',
      startAt: isoFromNow(150),
      assigneeIds: [alice.id, carol.id],
      reminders: [{ offsetMinutes: 20 }],
    });

    const res = await api()
      .delete(`/api/v1/events/${event.id}/assignments/${carol.id}`)
      .set(auth(admin.token));
    expect(res.status).toBe(200);

    const carolPending = await ReminderInstance.count({
      where: { eventId: event.id, userId: carol.id, status: 'pending' },
    });
    const alicePending = await ReminderInstance.count({
      where: { eventId: event.id, userId: alice.id, status: 'pending' },
    });

    expect(carolPending).toBe(0);
    expect(alicePending).toBe(1);
  });
});

describe('Scheduler restart recovery', () => {
  it('reclaims a reminder abandoned by a crashed worker', async () => {
    const victim = await createUserAndLogin();
    // The mock must return a REAL device id: notification_attempts.device_id
    // is a uuid FK, so a placeholder string would fail the insert.
    const device = await Device.create({
      userId: victim.id,
      fcmToken: `tok_orphan_${'w'.repeat(30)}`,
      platform: 'android',
    });

    const event = await createEvent({
      title: 'Orphaned',
      startAt: isoFromNow(1),
      assigneeIds: [victim.id],
      reminders: [{ offsetMinutes: 1 }],
    });

    // Simulate a worker that claimed the row and then died: status stuck at
    // `processing` with a lock older than the lease window.
    await ReminderInstance.update(
      {
        status: 'processing',
        lockedAt: new Date(Date.now() - 10 * 60_000),
        lockedBy: 'dead-worker:1',
      },
      { where: { eventId: event.id } }
    );

    const sendSpy = jest
      .spyOn(pushService, 'sendReminderToUserDevices')
      .mockResolvedValue([
        { deviceId: device.id, status: 'accepted', providerMessageId: 'recovered' },
      ] as any);

    await runSchedulerTick();

    const row = await ReminderInstance.findOne({ where: { eventId: event.id } });
    expect(row!.status).toBe('sent');
    expect(sendSpy).toHaveBeenCalledTimes(1);
    sendSpy.mockRestore();
  });

  it('does not steal a reminder whose lease is still valid', async () => {
    const victim = await createUserAndLogin();
    const event = await createEvent({
      title: 'Freshly locked',
      startAt: isoFromNow(1),
      assigneeIds: [victim.id],
      reminders: [{ offsetMinutes: 1 }],
    });

    await ReminderInstance.update(
      { status: 'processing', lockedAt: new Date(), lockedBy: 'other-worker:1' },
      { where: { eventId: event.id } }
    );

    const sendSpy = jest.spyOn(pushService, 'sendReminderToUserDevices');
    await runSchedulerTick();

    expect(sendSpy).not.toHaveBeenCalled();
    sendSpy.mockRestore();
  });

  it('expires a reminder that is far too late to be useful', async () => {
    const victim = await createUserAndLogin();
    await Device.create({
      userId: victim.id,
      fcmToken: `tok_stale_${'v'.repeat(30)}`,
      platform: 'android',
    });

    const event = await createEvent({
      title: 'Very late',
      startAt: isoFromNow(5),
      assigneeIds: [victim.id],
      reminders: [{ offsetMinutes: 1 }],
    });

    // Pretend the server was down for a day.
    await ReminderInstance.update(
      { scheduledAt: new Date(Date.now() - 24 * 60 * 60_000) },
      { where: { eventId: event.id } }
    );

    const sendSpy = jest.spyOn(pushService, 'sendReminderToUserDevices');
    await runSchedulerTick();

    const row = await ReminderInstance.findOne({ where: { eventId: event.id } });
    expect(row!.status).toBe('expired');
    expect(sendSpy).not.toHaveBeenCalled();
    sendSpy.mockRestore();
  });
});

describe('Push delivery failures and retries', () => {
  it('marks a reminder failed with a backoff when delivery errors', async () => {
    const victim = await createUserAndLogin();
    const device = await Device.create({
      userId: victim.id,
      fcmToken: `tok_fail_${'u'.repeat(30)}`,
      platform: 'android',
    });

    const event = await createEvent({
      title: 'Will fail',
      startAt: isoFromNow(1),
      assigneeIds: [victim.id],
      reminders: [{ offsetMinutes: 1 }],
    });

    const sendSpy = jest
      .spyOn(pushService, 'sendReminderToUserDevices')
      .mockResolvedValue([
        {
          deviceId: device.id,
          status: 'error',
          errorCode: 'messaging/internal-error',
          errorMessage: 'transient',
        },
      ] as any);

    await runSchedulerTick();

    const row = await ReminderInstance.findOne({ where: { eventId: event.id } });
    expect(row!.status).toBe('failed');
    expect(row!.attemptCount).toBe(1);
    // A retry must be scheduled in the future, not immediately.
    expect(row!.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    sendSpy.mockRestore();
  });

  it('records every delivery attempt for auditing', async () => {
    const victim = await createUserAndLogin();
    const device = await Device.create({
      userId: victim.id,
      fcmToken: `tok_audit_${'t'.repeat(30)}`,
      platform: 'android',
    });

    const event = await createEvent({
      title: 'Audited delivery',
      startAt: isoFromNow(1),
      assigneeIds: [victim.id],
      reminders: [{ offsetMinutes: 1 }],
    });

    const sendSpy = jest
      .spyOn(pushService, 'sendReminderToUserDevices')
      .mockResolvedValue([
        { deviceId: device.id, status: 'accepted', providerMessageId: 'msg-123' },
      ] as any);

    await runSchedulerTick();

    const reminder = await ReminderInstance.findOne({ where: { eventId: event.id } });
    const attempts = await NotificationAttempt.findAll({
      where: { reminderInstanceId: reminder!.id },
    });

    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe('accepted');
    expect(attempts[0].providerMessageId).toBe('msg-123');
    sendSpy.mockRestore();
  });

  it('deactivates a permanently invalid push token', async () => {
    const victim = await createUserAndLogin();
    const device = await Device.create({
      userId: victim.id,
      fcmToken: `tok_dead_${'s'.repeat(30)}`,
      platform: 'android',
    });

    const event = await createEvent({
      title: 'Dead token',
      startAt: isoFromNow(1),
      assigneeIds: [victim.id],
      reminders: [{ offsetMinutes: 1 }],
    });

    const sendSpy = jest
      .spyOn(pushService, 'sendReminderToUserDevices')
      .mockResolvedValue([
        {
          deviceId: device.id,
          status: 'rejected',
          errorCode: 'messaging/registration-token-not-registered',
          errorMessage: 'gone',
          tokenInvalid: true,
        },
      ] as any);

    await runSchedulerTick();

    await device.reload();
    expect(device.isActive).toBe(false);
    sendSpy.mockRestore();
  });

  it('fails a reminder when the user has no registered device', async () => {
    const victim = await createUserAndLogin();
    const event = await createEvent({
      title: 'No devices',
      startAt: isoFromNow(1),
      assigneeIds: [victim.id],
      reminders: [{ offsetMinutes: 1 }],
    });

    await runSchedulerTick();

    const row = await ReminderInstance.findOne({ where: { eventId: event.id } });
    expect(row!.status).toBe('failed');
    expect(row!.lastError).toMatch(/no active devices/i);
  });

  it('stops retrying once max attempts are exhausted', async () => {
    const victim = await createUserAndLogin();
    const device = await Device.create({
      userId: victim.id,
      fcmToken: `tok_exhaust_${'r'.repeat(28)}`,
      platform: 'android',
    });

    const event = await createEvent({
      title: 'Exhausted',
      startAt: isoFromNow(1),
      assigneeIds: [victim.id],
      reminders: [{ offsetMinutes: 1 }],
    });

    // One attempt short of the cap.
    await ReminderInstance.update(
      { attemptCount: 4 },
      { where: { eventId: event.id } }
    );

    const sendSpy = jest
      .spyOn(pushService, 'sendReminderToUserDevices')
      .mockResolvedValue([
        { deviceId: device.id, status: 'error', errorCode: 'messaging/internal-error' },
      ] as any);

    await runSchedulerTick();

    const row = await ReminderInstance.findOne({ where: { eventId: event.id } });
    expect(row!.attemptCount).toBe(5);
    expect(row!.nextAttemptAt).toBeNull();

    // A further tick must not pick it up again.
    sendSpy.mockClear();
    await runSchedulerTick();
    expect(sendSpy).not.toHaveBeenCalled();
    sendSpy.mockRestore();
  });
});
