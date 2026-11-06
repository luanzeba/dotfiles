// Five-field cron schedules (minute hour day-of-month month weekday) in local time, and their
// translation to launchd's StartCalendarInterval and systemd's OnCalendar. launchd and systemd do the
// actual scheduling; next() is for `dot jobs` (next run, lateness).

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'weekday', min: 0, max: 7 }, // 0 and 7 are Sunday
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Returns { minute, hour, day, month, weekday }: each a sorted array of allowed values, or null for "any".
export function parseCron(expression) {
  const parts = String(expression).trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`schedule "${expression}": expected 5 fields (minute hour day month weekday)`);
  const [minute, hour, day, month, weekday] = parts.map((part, i) => parseField(part, FIELDS[i], expression));
  // cron runs a job when *either* restricted day field matches; launchd and systemd don't agree on that.
  if (day && weekday) throw new Error(`schedule "${expression}": restrict the day of month or the weekday, not both`);
  return { minute, hour, day, month, weekday };
}

function parseField(text, { name, min, max }, expression) {
  const values = new Set();
  for (const item of text.split(',')) {
    const match = /^(?:(\*)|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(item);
    if (!match) throw new Error(`schedule "${expression}": invalid ${name} "${item}"`);
    const [, star, from, to, step] = match;
    const low = star ? min : Number(from);
    const high = star ? max : to !== undefined ? Number(to) : step !== undefined ? max : low;
    const by = step !== undefined ? Number(step) : 1;
    if (low < min || high > max || low > high || by < 1) {
      throw new Error(`schedule "${expression}": ${name} "${item}" is outside ${min}-${max}`);
    }
    for (let value = low; value <= high; value += by) values.add(name === 'weekday' ? value % 7 : value);
  }
  const span = name === 'weekday' ? 7 : max - min + 1;
  return values.size === span ? null : [...values].sort((a, b) => a - b);
}

const allows = (values, value) => values === null || values.includes(value);

// The first scheduled minute strictly after `after`, or null if none within four years.
export function next(schedule, after) {
  // The next whole minute, in epoch time: a local-time setter would be ambiguous in the repeated autumn hour.
  const time = new Date(Math.floor(after.getTime() / 60_000) * 60_000 + 60_000);
  const limit = after.getTime() + 4 * 366 * 86_400_000;
  while (time.getTime() <= limit) {
    const before = time.getTime();
    if (!allows(schedule.month, time.getMonth() + 1)) {
      time.setMonth(time.getMonth() + 1, 1);
      time.setHours(0, 0, 0, 0);
    } else if (!allows(schedule.day, time.getDate()) || !allows(schedule.weekday, time.getDay())) {
      time.setDate(time.getDate() + 1);
      time.setHours(0, 0, 0, 0);
    } else if (!allows(schedule.hour, time.getHours())) {
      time.setHours(time.getHours() + 1, 0, 0, 0);
    } else if (!allows(schedule.minute, time.getMinutes())) {
      time.setMinutes(time.getMinutes() + 1, 0, 0);
    } else {
      return time;
    }
    // Daylight-saving transitions can make a local-time setter land on or before where it started.
    if (time.getTime() <= before) time.setTime(before + 60_000);
  }
  return null;
}

// launchd StartCalendarInterval: one dictionary per combination of restricted values.
export function launchdCalendar(schedule) {
  const keys = [['Minute', schedule.minute], ['Hour', schedule.hour], ['Day', schedule.day],
    ['Month', schedule.month], ['Weekday', schedule.weekday]];
  let entries = [{}];
  for (const [key, values] of keys) {
    if (values === null) continue;
    entries = entries.flatMap(entry => values.map(value => ({ ...entry, [key]: value })));
  }
  return entries;
}

// systemd OnCalendar, with every restricted field spelled out as a list ("Mon,Tue *-*-* 09:00,30:00").
export function systemdCalendar(schedule) {
  const list = values => (values === null ? '*' : values.map(v => String(v).padStart(2, '0')).join(','));
  const weekdays = schedule.weekday === null ? '' : `${schedule.weekday.map(d => WEEKDAYS[d]).join(',')} `;
  return `${weekdays}*-${list(schedule.month)}-${list(schedule.day)} ${list(schedule.hour)}:${list(schedule.minute)}:00`;
}
