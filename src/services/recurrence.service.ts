import { DateTime } from 'luxon';
import { Event, RecurrenceFrequency } from '../modules/events/event.model';

/**
 * Expands a (possibly recurring) event into the UTC start instants of its
 * occurrences inside a window.
 *
 * Recurrence is stepped in the event's OWN timezone, not in UTC. Stepping in
 * UTC would silently shift a 09:00 daily standup to 08:00 or 10:00 once the
 * event's zone crosses a DST boundary. Stepping in the zone and converting
 * back to UTC each time keeps the wall-clock time stable, which is what a
 * human means by "every day at 9".
 */
export const expandOccurrences = (
  event: Pick<
    Event,
    | 'startAt'
    | 'timezone'
    | 'recurrenceFrequency'
    | 'recurrenceInterval'
    | 'recurrenceDaysOfWeek'
    | 'recurrenceEndAt'
  >,
  windowStart: Date,
  windowEnd: Date,
  maxOccurrences = 500
): Date[] => {
  const zone = event.timezone;
  const frequency: RecurrenceFrequency = event.recurrenceFrequency || 'none';
  const first = DateTime.fromJSDate(event.startAt, { zone: 'utc' }).setZone(zone);

  if (!first.isValid) return [];

  if (frequency === 'none') {
    const t = first.toJSDate();
    return t >= windowStart && t <= windowEnd ? [t] : [];
  }

  const interval = Math.max(1, event.recurrenceInterval || 1);
  const hardEnd = event.recurrenceEndAt
    ? DateTime.fromJSDate(event.recurrenceEndAt, { zone: 'utc' })
    : null;

  const results: Date[] = [];
  const windowEndDt = DateTime.fromJSDate(windowEnd, { zone: 'utc' });
  const windowStartDt = DateTime.fromJSDate(windowStart, { zone: 'utc' });

  // Weekly with explicit weekdays repeats within each week-step.
  const weekdays =
    frequency === 'weekly' && Array.isArray(event.recurrenceDaysOfWeek)
      ? (event.recurrenceDaysOfWeek as number[]).filter((d) => d >= 1 && d <= 7)
      : [];

  let cursor = first;
  let guard = 0;
  const GUARD_LIMIT = maxOccurrences * 10;

  while (guard++ < GUARD_LIMIT && results.length < maxOccurrences) {
    const candidates: DateTime[] =
      weekdays.length > 0
        ? weekdays.map((wd) => cursor.startOf('week').plus({ days: wd - 1 }).set({
            hour: first.hour,
            minute: first.minute,
            second: first.second,
            millisecond: 0,
          }))
        : [cursor];

    for (const c of candidates) {
      const utc = c.toUTC();
      if (!c.isValid) continue;
      if (utc < DateTime.fromJSDate(event.startAt, { zone: 'utc' })) continue;
      if (hardEnd && utc > hardEnd) continue;
      if (utc > windowEndDt) continue;
      if (utc < windowStartDt) continue;
      results.push(utc.toJSDate());
    }

    // Stop once the cursor itself has run past the window or the series end.
    const cursorUtc = cursor.toUTC();
    if (cursorUtc > windowEndDt) break;
    if (hardEnd && cursorUtc > hardEnd) break;

    cursor =
      frequency === 'daily'
        ? cursor.plus({ days: interval })
        : frequency === 'weekly'
          ? cursor.plus({ weeks: interval })
          : cursor.plus({ months: interval });

    if (!cursor.isValid) break;
  }

  // Deduplicate (weekday expansion can revisit an instant) and sort.
  const seen = new Set<number>();
  return results
    .filter((d) => {
      const k = d.getTime();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.getTime() - b.getTime());
};

/** Absolute UTC instant a reminder fires, given an occurrence and an offset. */
export const reminderTimeFor = (occurrenceStart: Date, offsetMinutes: number): Date =>
  new Date(occurrenceStart.getTime() - offsetMinutes * 60_000);
