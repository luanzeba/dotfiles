import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.TZ = 'Europe/Vienna'; // daylight saving: 2026-03-29 02:00 -> 03:00, 2026-10-25 03:00 -> 02:00
const { launchdCalendar, next, parseCron, systemdCalendar } = await import('../cron.mjs');

const at = text => new Date(text); // local time, e.g. '2026-11-06T14:10'
const local = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  + `T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

test('parses fields into allowed values, null meaning any', () => {
  assert.deepEqual(parseCron('*/30 * * * *'), { minute: [0, 30], hour: null, day: null, month: null, weekday: null });
  assert.deepEqual(parseCron('0 9 * * 1-5').weekday, [1, 2, 3, 4, 5]);
  assert.deepEqual(parseCron('5/15 * * * *').minute, [5, 20, 35, 50]);
  assert.deepEqual(parseCron('0 0 * * 0,7').weekday, [0]);
  assert.deepEqual(parseCron('0 8-10,14 * * *').hour, [8, 9, 10, 14]);
  assert.equal(parseCron('*/1 * * * *').minute, null);
  assert.equal(parseCron('0 0 * * 0-6').weekday, null);
});

test('rejects schedules it cannot translate faithfully', () => {
  for (const bad of ['* * * *', '60 * * * *', '5-1 * * * *', 'a * * * *', '*/0 * * * *', '0 0 32 * *', '0 9 1 * 1']) {
    assert.throws(() => parseCron(bad), /schedule/, bad);
  }
});

test('next is strictly after the given time', () => {
  const halfHourly = parseCron('*/30 * * * *');
  assert.equal(local(next(halfHourly, at('2026-11-06T14:10:30'))), '2026-11-06T14:30');
  assert.equal(local(next(halfHourly, at('2026-11-06T14:30:00'))), '2026-11-06T15:00');
  assert.equal(local(next(halfHourly, at('2026-12-31T23:45'))), '2027-01-01T00:00');
  const weekdays = parseCron('30 9 * * 1-5');
  assert.equal(local(next(weekdays, at('2026-11-06T10:00'))), '2026-11-09T09:30'); // Friday -> Monday
  assert.equal(local(next(parseCron('0 0 29 2 *'), at('2026-03-01T00:00'))), '2028-02-29T00:00');
});

test('daylight-saving transitions neither loop nor invent times', () => {
  const twoThirty = parseCron('30 2 * * *');
  assert.equal(local(next(twoThirty, at('2026-03-28T03:00'))), '2026-03-30T02:30'); // 02:30 doesn't exist on 03-29
  const autumn = next(twoThirty, at('2026-10-25T00:00'));
  assert.equal(local(autumn), '2026-10-25T02:30');
  assert.equal(local(next(twoThirty, autumn)), '2026-10-26T02:30'); // the repeated hour fires once
  assert.equal(local(next(parseCron('*/30 * * * *'), at('2026-03-29T01:45'))), '2026-03-29T03:00');
  // Inside the repeated hour (the second 02:10, in winter time), the next run is still later.
  const repeated = new Date('2026-10-25T01:10:00Z');
  assert.ok(next(parseCron('*/30 * * * *'), repeated) > repeated);
  assert.equal(next(parseCron('*/30 * * * *'), repeated).toISOString(), '2026-10-25T01:30:00.000Z');
});

test('translates to launchd calendar intervals', () => {
  assert.deepEqual(launchdCalendar(parseCron('*/30 * * * *')), [{ Minute: 0 }, { Minute: 30 }]);
  assert.deepEqual(launchdCalendar(parseCron('* * * * *')), [{}]);
  assert.deepEqual(launchdCalendar(parseCron('0 9,17 * * 1-2')), [
    { Minute: 0, Hour: 9, Weekday: 1 }, { Minute: 0, Hour: 9, Weekday: 2 },
    { Minute: 0, Hour: 17, Weekday: 1 }, { Minute: 0, Hour: 17, Weekday: 2 },
  ]);
});

test('translates to systemd OnCalendar', () => {
  assert.equal(systemdCalendar(parseCron('*/30 * * * *')), '*-*-* *:00,30:00');
  assert.equal(systemdCalendar(parseCron('30 9 * * 1-5')), 'Mon,Tue,Wed,Thu,Fri *-*-* 09:30:00');
  assert.equal(systemdCalendar(parseCron('0 0 1 */3 *')), '*-01,04,07,10-01 00:00:00');
  assert.equal(systemdCalendar(parseCron('* * * * 0')), 'Sun *-*-* *:*:00');
});
