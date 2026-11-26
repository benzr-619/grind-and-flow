// parse.js — One List entry-bar parser (pure functions, no DOM, no Data).
// Loaded before app.js in the browser (global `GFParse`) and require()-able from
// node for dev/parse.test.js. All dates are local YYYY-MM-DD strings.
//
//   parseWhen('asap')        → { urgency:'asap', label:'asap' }
//   parseWhen('i' | 'idea')  → { idea:true, label:'idea' }
//   parseWhen('dec 4', today)→ { dueDate:'2026-12-04', label:'by Dec 4' }
//   parseWhen('every 2w')    → { recur:{ recurrence:'rolling', … }, label:'↻ every 2 weeks' }
//   parseWhen('every 2nd & 4th mon') → { recur:{ recurrence:'anchored', recurrenceWeekdays:[0], recurrenceNth:[2,4], … }, label:'↻ 2nd & 4th Mon' }
//   parseArea('r')           → 'Research'
//   parseTitle('#amd fix x asap') → { title:'fix x', area:'AMD', when:{…} }

(function (root) {
  const AREAS = ['Research', 'AMD', 'EDBA', 'Home'];
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const DOWS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']; // 0 = Mon … 6 = Sun
  const DOW_FULL = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  function ymd(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function toDate(s) { return new Date(s + 'T00:00:00'); }
  function addDays(s, n) { const d = toDate(s); d.setDate(d.getDate() + n); return ymd(d); }
  function addMonths(s, n) { const d = toDate(s); d.setMonth(d.getMonth() + n); return ymd(d); }
  function dowOf(s) { return (toDate(s).getDay() + 6) % 7; }
  function fmt(s) { return toDate(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }

  // 'mon' | 'monday' | 'tues' … → 0..6, else -1
  function dowIndex(w) {
    w = (w || '').toLowerCase().replace(/\.$/, '');
    if (w.length < 2) return -1;
    for (let i = 0; i < 7; i++) if (DOW_FULL[i].startsWith(w) && w.length >= 3) return i;
    if (w === 'tu') return 1; if (w === 'th') return 3; if (w === 'su') return 6; if (w === 'sa') return 5;
    return -1;
  }
  function monthIndex(w) {
    w = (w || '').toLowerCase().replace(/\.$/, '');
    if (w.length < 3) return -1;
    const i = MONTHS.findIndex(m => w.startsWith(m));
    if (i < 0) return -1;
    const full = new Date(2000, i, 1).toLocaleDateString('en-US', { month: 'long' }).toLowerCase();
    return full.startsWith(w) ? i : -1;
  }

  // Next date (≥ today) falling on weekday `dow`.
  function nextDow(today, dow) {
    const diff = (dow - dowOf(today) + 7) % 7;
    return addDays(today, diff);
  }
  // Next date (≥ today) whose day-of-month is `md` (clamped to month length).
  function nextMonthDay(today, md) {
    const t = toDate(today);
    for (let k = 0; k < 3; k++) {
      const y = t.getFullYear(), m = t.getMonth() + k;
      const last = new Date(y, m + 1, 0).getDate();
      const d = new Date(y, m, Math.min(md, last));
      if (ymd(d) >= today) return ymd(d);
    }
    return today;
  }
  // month/day → date this year, or next year if it is more than 30 days in the past.
  function monthDayDate(today, mi, day) {
    const t = toDate(today);
    let y = t.getFullYear();
    let d = new Date(y, mi, day);
    if (d.getMonth() !== mi) return null; // e.g. feb 31
    if ((t - d) / 86400000 > 30) d = new Date(y + 1, mi, day);
    return ymd(d);
  }

  // A plain date expression → YYYY-MM-DD or null.
  function parseDate(str, today) {
    const q = (str || '').trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
    if (!q) return null;
    if (q === 'today' || q === 'tod' || q === 'tdy') return today;
    if (q === 'tomorrow' || q === 'tmr' || q === 'tom' || q === 'tmrw') return addDays(today, 1);
    if (q === 'next week' || q === 'nw') return nextDow(addDays(today, 1), 0);
    if (q === 'eow' || q === 'end of week') return nextDow(today, 4);
    if (q === 'eom' || q === 'end of month') { const t = toDate(today); return ymd(new Date(t.getFullYear(), t.getMonth() + 1, 0)); }
    let m;
    // weekday: "fri", "friday", "next fri"
    m = q.match(/^(next )?([a-z]+)$/);
    if (m && dowIndex(m[2]) >= 0) {
      const d = nextDow(today, dowIndex(m[2]));
      return m[1] && d === today ? addDays(d, 7) : d;
    }
    // relative: "3d", "in 3d", "in 3 days", "2w", "in 2 weeks"
    m = q.match(/^(?:in )?(\d+) ?(d|day|days|w|wk|wks|week|weeks|m|mo|month|months)$/);
    if (m) {
      const n = +m[1], u = m[2][0];
      return u === 'd' ? addDays(today, n) : u === 'w' ? addDays(today, n * 7) : addMonths(today, n);
    }
    // "dec 4", "december 4th"
    m = q.match(/^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/);
    if (m && monthIndex(m[1]) >= 0) {
      if (m[3]) { const d = new Date(+m[3], monthIndex(m[1]), +m[2]); return d.getMonth() === monthIndex(m[1]) ? ymd(d) : null; }
      return monthDayDate(today, monthIndex(m[1]), +m[2]);
    }
    // "4 dec", "4th december"
    m = q.match(/^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)\.?$/);
    if (m && monthIndex(m[2]) >= 0) return monthDayDate(today, monthIndex(m[2]), +m[1]);
    // "12/4", "12/4/2026", "12/4/26"
    m = q.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (m) {
      const mi = +m[1] - 1, day = +m[2];
      if (mi < 0 || mi > 11) return null;
      if (m[3]) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; const d = new Date(y, mi, day); return d.getMonth() === mi ? ymd(d) : null; }
      return monthDayDate(today, mi, day);
    }
    // ISO
    m = q.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return q;
    return null;
  }

  // "every …" → recurrence fields (the Data.addTask `recur` object), or null.
  function parseEvery(str, today) {
    const q = (str || '').trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
    const m0 = q.match(/^(?:every|each|evry) (.+)$/);
    if (!m0) return null;
    const rest = m0[1];
    let m;
    // rolling: "5d", "5 days", "2w", "week", "month", "3 months", "other week", "year"
    m = rest.match(/^(\d+)? ?(d|day|days|w|wk|wks|week|weeks|m|mo|mos|month|months|y|yr|year|years)$/);
    if (!m && rest === 'other week') m = [rest, '2', 'w'];
    if (!m && rest === 'other day') m = [rest, '2', 'd'];
    if (!m && rest === 'other month') m = [rest, '2', 'm'];
    if (m) {
      let n = m[1] ? +m[1] : 1, u = m[2][0];
      if (n < 1) return null;
      let unit = u === 'd' ? 'days' : u === 'w' ? 'weeks' : 'months';
      if (u === 'y') { unit = 'months'; n *= 12; }
      const rec = { recurrence: 'rolling', recurrenceIntervalN: n, recurrenceIntervalUnit: unit, recurrenceLeadDays: 1 };
      // First occurrence: one interval from today (the cadence starts when it's entered).
      rec.scheduledDate = unit === 'days' ? addDays(today, n) : unit === 'weeks' ? addDays(today, n * 7) : addMonths(today, n);
      const unitLabel = n === 1 ? unit.replace(/s$/, '') : unit;
      return { recur: rec, label: `↻ every ${n === 1 ? '' : n + ' '}${unitLabel}` };
    }
      // anchored nth weekday: "2nd and 4th mon", "2st & 4rd monday", "1st, 3rd tue",
    // "last fri", "2 4 mon". Any ordinal suffix (or none) is ignored — only the digit counts.
    const nthDays = parseNthWeekdays(rest);
    if (nthDays) {
      const due = nextNthWeekday(today, nthDays.weekdays, nthDays.nth, true);
      return {
        recur: { recurrence: 'anchored', recurrenceWeekdays: nthDays.weekdays, recurrenceNth: nthDays.nth, recurrenceMonthDay: null, recurrenceLeadDays: 1, dueDate: due },
        label: '↻ ' + nthLabel(nthDays.weekdays, nthDays.nth),
      };
    }
    // anchored weekdays: "mon", "mon thu", "mon/thu", "mon and thu", "monday"
    const words = rest.split(/[\s/&+]+|and/).filter(Boolean);
    const dows = words.map(dowIndex);
    if (words.length && dows.every(d => d >= 0)) {
      const days = [...new Set(dows)].sort((a, b) => a - b);
      const due = days.map(d => nextDow(today, d)).sort()[0];
      return {
        recur: { recurrence: 'anchored', recurrenceWeekdays: days, recurrenceMonthDay: null, recurrenceLeadDays: 1, dueDate: due },
        label: `↻ every ${days.map(d => DOWS[d][0].toUpperCase() + DOWS[d].slice(1)).join(' ')}`,
      };
    }
    // anchored month day: "15th", "1st", "15"
    m = rest.match(/^(?:the )?(\d{1,2})(?:st|nd|rd|th)?(?: of the month)?$/);
    if (m && +m[1] >= 1 && +m[1] <= 31) {
      const md = +m[1];
      return {
        recur: { recurrence: 'anchored', recurrenceWeekdays: null, recurrenceMonthDay: md, recurrenceLeadDays: 1, dueDate: nextMonthDay(today, md) },
        label: `↻ every ${m[1]}${ordinal(md)}`,
      };
    }
    return null;
  }
  // "2nd and 4th mon" → { nth:[2,4], weekdays:[0] }, else null. Ordinals first (1–5 with
  // any 0–2 letter suffix, or "last" → -1), then one or more weekdays.
  function parseNthWeekdays(rest) {
    const toks = rest.split(/[\s/&+,]+/).filter(w => w && w !== 'and' && w !== 'the');
    const nth = [], days = [];
    for (const w of toks) {
      const d = dowIndex(w);
      if (d >= 0) { days.push(d); continue; }
      if (days.length) return null; // ordinals must come before the weekdays
      const m = w.match(/^([1-5])[a-z]{0,2}$/);
      if (m) nth.push(+m[1]);
      else if (w === 'last' || w === 'lst') nth.push(-1);
      else return null;
    }
    if (!nth.length || !days.length) return null;
    return { nth: [...new Set(nth)].sort(nthSort), weekdays: [...new Set(days)].sort((a, b) => a - b) };
  }
  function nthSort(a, b) { return (a < 0 ? 9 : a) - (b < 0 ? 9 : b); } // "last" sorts after 5th

  // Is date `s` the nth (1–5) of its weekday in its month, or the last one (-1)?
  function isNthOfMonth(s, nth) {
    const d = toDate(s), day = d.getDate();
    const monthLen = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return nth.includes(Math.ceil(day / 7)) || (nth.includes(-1) && day + 7 > monthLen);
  }
  // First date on one of `weekdays` (0=Mon…6=Sun) that also matches `nth` (null/[] = any
  // week), starting at `from` (inclusive) or the day after it. Scans ~13 months, since a
  // 5th weekday only exists in some months.
  function nextNthWeekday(from, weekdays, nth, inclusive) {
    if (!weekdays || !weekdays.length) return null;
    let s = inclusive ? from : addDays(from, 1);
    for (let i = 0; i < 400; i++, s = addDays(s, 1)) {
      if (weekdays.includes(dowOf(s)) && (!nth || !nth.length || isNthOfMonth(s, nth))) return s;
    }
    return null;
  }
  // [0], [2,4] → "2nd & 4th Mon"; [1], [1,3,-1] → "1st, 3rd & last Tue"; [4], [-1] → "last Fri".
  function nthLabel(weekdays, nth) {
    const ords = [...nth].sort(nthSort).map(n => n < 0 ? 'last' : n + ordinal(n));
    const ordTxt = ords.length > 1 ? ords.slice(0, -1).join(', ') + ' & ' + ords[ords.length - 1] : ords[0];
    const dayTxt = [...weekdays].sort((a, b) => a - b).map(d => DOWS[d][0].toUpperCase() + DOWS[d].slice(1)).join('/');
    return `${ordTxt} ${dayTxt}`;
  }

  function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return s[(v - 20) % 10] || s[v] || s[0]; }

  // The priority/date step: asap · no rush · idea · a date (or every …).
  // '' → null. Unparseable → { invalid:true, label }. Only exact "i"/"idea" mean idea,
  // so "in 3d" / "in 2w" still reach the date parser.
  function parseWhen(str, today) {
    const raw = (str || '').trim();
    const q = raw.toLowerCase();
    if (!q) return null;
    if (q === 'a' || q === 'asap' || q === '!') return { urgency: 'asap', label: 'asap' };
    if (q === 'n' || q === 'norush' || q === 'no rush' || q === 'no-rush' || q === 'nr') return { urgency: 'norush', label: 'no rush' };
    if (q === 'i' || q === 'idea') return { idea: true, label: 'idea' };
    const ev = parseEvery(q, today);
    if (ev) return ev;
    const d = parseDate(q.replace(/^(by|due|before) /, ''), today);
    if (d) return { dueDate: d, label: 'by ' + fmt(d) };
    return { invalid: true, label: raw };
  }

  // The area step: one letter or any prefix, case-insensitive. '' / no match → null.
  function parseArea(str) {
    const q = (str || '').trim().toLowerCase().replace(/^#/, '');
    if (!q) return null;
    return AREAS.find(a => a.toLowerCase().startsWith(q)) || null;
  }

  // Title step with inline shortcuts:
  //   "idea: …" prefix → isIdea
  //   "#amd" / "#r" anywhere → area
  //   trailing "asap" / "!" / "no rush" / "norush" → urgency
  //   trailing "by fri" / "due dec 4" → dueDate
  //   trailing "every 2w" / "every mon" → recurrence
  // Returns { title, isIdea, area, when } (when = a parseWhen result or null).
  function parseTitle(raw, today) {
    let s = (raw || '').trim();
    let isIdea = false, area = null, when = null;
    const im = s.match(/^idea\s*:\s*/i);
    if (im) { isIdea = true; s = s.slice(im[0].length); }
    // #area tokens (only real areas — "#1 priority" stays in the title)
    s = s.replace(/(^|\s)#([a-z]+)\b/gi, (all, pre, tag) => {
      const a = parseArea(tag);
      if (a && !area) { area = a; return pre; }
      return all;
    }).replace(/\s+/g, ' ').trim();
    // trailing "every …"
    let m = s.match(/\s+(every\s+[\w\s/&+,]+)$/i);
    if (m) { const ev = parseEvery(m[1], today); if (ev) { when = ev; s = s.slice(0, m.index).trim(); } }
    // trailing "by …" / "due …"
    if (!when) {
      m = s.match(/\s+(?:by|due)\s+([\w\s/.,-]+)$/i);
      if (m) { const d = parseDate(m[1], today); if (d) { when = { dueDate: d, label: 'by ' + fmt(d) }; s = s.slice(0, m.index).trim(); } }
    }
    // trailing urgency word
    m = s.match(/\s+(asap|!|no rush|norush)$/i);
    if (m) {
      const u = /asap|!/i.test(m[1]) ? { urgency: 'asap', label: 'asap' } : { urgency: 'norush', label: 'no rush' };
      if (!when) when = u; else Object.assign(when, { urgency: u.urgency });
      s = s.slice(0, m.index).trim();
      // "fix x asap #amd" order is handled above; also allow "… asap by fri"
    }
    if (!s) s = (raw || '').trim(); // never strip a title down to nothing
    return { title: s, isIdea, area, when };
  }

  // Capture-time capitalization (sentence case, add-only). Runs on the title after
  // parseTitle strips the inline shortcuts, before Data.addTask — never on later edits.
  //   1. whole title in capitals (≥2 letters, no lowercase) → lowercase it (caps-lock catch)
  //   2. CASE_WORDS typed in any case → their listed form (whole word; punctuation kept)
  //   3. uppercase the first letter — unless the first word already has a capital inside
  //      it (iPhone, eGFR), which is the user's own casing
  //   Everything else is left exactly as typed.
  const CASE_WORDS = ['AMD', 'EDBA', 'ED', 'RME', 'NYP', 'CUIMC', 'EKG', 'EMS', 'STEMI', 'ECAT', 'QI', 'CV', 'PDF', 'MHA', 'Mo', 'Tristen'];
  const _CASE_MAP = new Map(CASE_WORDS.map(w => [w.toLowerCase(), w]));
  function normalizeCase(title) {
    let s = title || '';
    const letters = s.match(/\p{L}/gu) || [];
    if (letters.length >= 2 && !/\p{Ll}/u.test(s)) s = s.toLowerCase();
    s = s.replace(/[\p{L}\p{N}]+/gu, w => _CASE_MAP.get(w.toLowerCase()) || w);
    const m = s.match(/[\p{L}\p{N}]+/u);
    if (m && /^\p{Ll}/u.test(m[0]) && !/\p{Lu}/u.test(m[0].slice(1))) {
      s = s.slice(0, m.index) + m[0][0].toUpperCase() + s.slice(m.index + 1);
    }
    return s;
  }

  // Close-title match for the "already have: …" hint. Returns the best candidate or null.
  function similarity(a, b) {
    const norm = x => (x || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2);
    const A = new Set(norm(a)), B = new Set(norm(b));
    if (!A.size || !B.size) return 0;
    let inter = 0; A.forEach(w => { if (B.has(w)) inter++; });
    return inter / Math.min(A.size, B.size) * (inter / Math.max(A.size, B.size)) ** 0.25;
  }
  function closeMatch(title, candidates) {
    const t = (title || '').trim().toLowerCase();
    if (t.length < 4) return null;
    let best = null, bestScore = 0;
    (candidates || []).forEach(c => {
      const ct = (c.title || '').toLowerCase();
      let score = ct === t ? 1 : (ct.includes(t) || t.includes(ct)) && Math.min(ct.length, t.length) >= 6 ? 0.9 : similarity(t, ct);
      if (score > bestScore) { bestScore = score; best = c; }
    });
    return bestScore >= 0.6 ? best : null;
  }

  const api = { AREAS, CASE_WORDS, normalizeCase, parseWhen, parseArea, parseTitle, parseDate, parseEvery, nextNthWeekday, nthLabel, closeMatch, ymd, addDays, fmt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GFParse = api;
})(typeof window !== 'undefined' ? window : globalThis);
