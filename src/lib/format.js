const TZ = 'Asia/Kolkata';

const MONTHS_GU = ['જાન્યુ', 'ફેબ્રુ', 'માર્ચ', 'એપ્રિલ', 'મે', 'જૂન', 'જુલાઈ', 'ઑગસ્ટ', 'સપ્ટે', 'ઑક્ટો', 'નવે', 'ડિસે'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Date parts in India time, regardless of the server's timezone. */
function partsIST(date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return { year: +p.year, month: +p.month - 1, day: +p.day, hour: +p.hour, minute: p.minute };
}

function dayPeriodGu(hour) {
  if (hour < 12) return 'સવારે';
  if (hour < 16) return 'બપોરે';
  if (hour < 20) return 'સાંજે';
  return 'રાત્રે';
}

/** Adds the display fields the app's event card expects (day, month, time). */
export function eventView(event) {
  const e = event.toJSON ? event.toJSON() : event;
  const p = partsIST(new Date(e.date));
  const h12 = p.hour % 12 || 12;
  return {
    ...e,
    day: p.day,
    month: { gu: MONTHS_GU[p.month], en: MONTHS_EN[p.month] },
    time: {
      gu: `${dayPeriodGu(p.hour)} ${h12}:${p.minute} વાગ્યે`,
      en: `${h12}:${p.minute} ${p.hour < 12 ? 'AM' : 'PM'}`,
    },
  };
}

/** First letter (grapheme cluster) of a name, so Gujarati conjuncts like "પ્ર" stay whole. */
export function initialOf(name) {
  const seg = new Intl.Segmenter('gu', { granularity: 'grapheme' });
  const first = seg.segment(name.trim())[Symbol.iterator]().next().value;
  return first ? first.segment : '?';
}
