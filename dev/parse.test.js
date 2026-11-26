// dev/parse.test.js — unit tests for parse.js (the entry-bar parser).
//   node dev/parse.test.js
// Fixed "today" = Wed 2026-11-25 so results are deterministic.
const assert = require('assert');
const P = require('../parse.js');
const T = '2026-11-25'; // Wednesday

let n = 0;
function eq(actual, expected, label) {
  assert.deepStrictEqual(actual, expected, label);
  n++;
}

// ── parseWhen: urgency ──
eq(P.parseWhen('asap', T), { urgency: 'asap', label: 'asap' }, 'asap');
eq(P.parseWhen('a', T).urgency, 'asap', 'a → asap');
eq(P.parseWhen('no rush', T).urgency, 'norush', 'no rush');
eq(P.parseWhen('n', T).urgency, 'norush', 'n → norush');
eq(P.parseWhen('norush', T).urgency, 'norush', 'norush');
eq(P.parseWhen('', T), null, 'empty → null');
eq(P.parseWhen('i', T), { idea: true, label: 'idea' }, 'i → idea');
eq(P.parseWhen('idea', T), { idea: true, label: 'idea' }, 'idea');
eq(P.parseWhen('IDEA', T).idea, true, 'idea case-insensitive');
eq(P.parseWhen('in 3d', T).idea, undefined, 'in 3d is not an idea');
eq(P.parseWhen('in 2w', T).dueDate, '2026-12-09', 'in 2w still a date');
eq(P.parseWhen('ideas', T).invalid, true, 'longer than idea → date parser (invalid)');

// ── parseWhen: dates ──
eq(P.parseWhen('fri', T).dueDate, '2026-11-27', 'fri → this Friday');
eq(P.parseWhen('friday', T).dueDate, '2026-11-27', 'friday');
eq(P.parseWhen('wed', T).dueDate, '2026-11-25', 'same weekday → today');
eq(P.parseWhen('next wed', T).dueDate, '2026-12-02', 'next wed → a week out');
eq(P.parseWhen('mon', T).dueDate, '2026-11-30', 'mon → next Monday');
eq(P.parseWhen('dec 4', T).dueDate, '2026-12-04', 'dec 4');
eq(P.parseWhen('December 4th', T).dueDate, '2026-12-04', 'December 4th');
eq(P.parseWhen('4 dec', T).dueDate, '2026-12-04', '4 dec');
eq(P.parseWhen('12/4', T).dueDate, '2026-12-04', '12/4');
eq(P.parseWhen('by dec 4', T).dueDate, '2026-12-04', 'by prefix');
eq(P.parseWhen('jan 10', T).dueDate, '2027-01-10', 'jan rolls to next year');
eq(P.parseWhen('nov 20', T).dueDate, '2026-11-20', 'recent past stays this year (overdue)');
eq(P.parseWhen('tomorrow', T).dueDate, '2026-11-26', 'tomorrow');
eq(P.parseWhen('in 3d', T).dueDate, '2026-11-28', 'in 3d');
eq(P.parseWhen('2w', T).dueDate, '2026-12-09', '2w');
eq(P.parseWhen('dec 4', T).label, 'by Dec 4', 'date label');
eq(P.parseWhen('feb 30', T).invalid, true, 'impossible date → invalid');
eq(P.parseWhen('blah', T), { invalid: true, label: 'blah' }, 'gibberish → invalid');

// ── parseWhen: recurrence ──
const r5 = P.parseWhen('every 5d', T).recur;
eq([r5.recurrence, r5.recurrenceIntervalN, r5.recurrenceIntervalUnit, r5.scheduledDate], ['rolling', 5, 'days', '2026-11-30'], 'every 5d → rolling');
const r2w = P.parseWhen('every 2w', T).recur;
eq([r2w.recurrence, r2w.recurrenceIntervalN, r2w.recurrenceIntervalUnit], ['rolling', 2, 'weeks'], 'every 2w');
const rm = P.parseWhen('every month', T).recur;
eq([rm.recurrence, rm.recurrenceIntervalN, rm.recurrenceIntervalUnit, rm.scheduledDate], ['rolling', 1, 'months', '2026-12-25'], 'every month');
eq(P.parseWhen('every 3 months', T).recur.recurrenceIntervalN, 3, 'every 3 months');
eq(P.parseWhen('every other week', T).recur.recurrenceIntervalN, 2, 'every other week');
const rMon = P.parseWhen('every mon', T).recur;
eq([rMon.recurrence, rMon.recurrenceWeekdays, rMon.dueDate], ['anchored', [0], '2026-11-30'], 'every mon → anchored');
const rMT = P.parseWhen('every mon thu', T).recur;
eq([rMT.recurrenceWeekdays, rMT.dueDate], [[0, 3], '2026-11-26'], 'every mon thu → soonest Thu');
const r15 = P.parseWhen('every 15th', T).recur;
eq([r15.recurrence, r15.recurrenceMonthDay, r15.dueDate], ['anchored', 15, '2026-12-15'], 'every 15th');
eq(P.parseWhen('every 25th', T).recur.dueDate, '2026-11-25', 'every 25th → today');
eq(P.parseWhen('every 31st', T).recur.dueDate, '2026-11-30', 'every 31st clamps to month end');
eq(P.parseWhen('every 5d', T).label, '↻ every 5 days', 'recur label');

// ── parseArea ──
eq(P.parseArea('r'), 'Research', 'r');
eq(P.parseArea('a'), 'AMD', 'a');
eq(P.parseArea('e'), 'EDBA', 'e');
eq(P.parseArea('h'), 'Home', 'h');
eq(P.parseArea('HOME'), 'Home', 'case-insensitive');
eq(P.parseArea('#amd'), 'AMD', '#amd');
eq(P.parseArea('x'), null, 'no match');
eq(P.parseArea(''), null, 'empty');

// ── parseTitle (inline shortcuts) ──
eq(P.parseTitle('Reply to cardiology #amd asap', T), { title: 'Reply to cardiology', isIdea: false, area: 'AMD', when: { urgency: 'asap', label: 'asap' } }, '#area + asap');
eq(P.parseTitle('idea: stats series #research', T).isIdea, true, 'idea: prefix');
eq(P.parseTitle('idea: stats series #research', T).title, 'stats series', 'idea: title stripped');
eq(P.parseTitle('Idea:x', T).isIdea, true, 'idea: case/spacing');
eq(P.parseTitle('idea: grant pitch by dec 4', T).isIdea, true, 'idea: + trailing date → still idea');
eq(P.parseTitle('idea: grant pitch by dec 4', T).title, 'grant pitch', 'idea: + date title stripped');
eq(P.parseTitle('idea: grant pitch by dec 4', T).when.dueDate, '2026-12-04', 'idea: + date parsed (app ignores it)');
eq(P.parseTitle('new idea board by fri', T).isIdea, false, '"idea" mid-title is not the prefix');
eq(P.parseTitle('draft grant by dec 4', T).when.dueDate, '2026-12-04', 'by date');
eq(P.parseTitle('draft grant by dec 4', T).title, 'draft grant', 'by date stripped');
eq(P.parseTitle('reorganize closet no rush', T).when.urgency, 'norush', 'trailing no rush');
eq(P.parseTitle('clean fountain every 5d #home', T).when.recur.recurrenceIntervalN, 5, 'every in title');
eq(P.parseTitle('clean fountain every 5d #home', T).area, 'Home', 'area with every');
eq(P.parseTitle('pay rent every 1st', T).when.recur.recurrenceMonthDay, 1, 'every 1st in title');
eq(P.parseTitle('#1 priority thing', T).title, '#1 priority thing', 'non-area # kept');
eq(P.parseTitle('Write by the lake', T).title, 'Write by the lake', '"by" without a date kept');
eq(P.parseTitle('asap', T).title, 'asap', 'never strip to empty');

// ── normalizeCase (capture-time capitalization) ──
const C = P.normalizeCase;
eq(C('reply to cardiology'), 'Reply to cardiology', 'lowercase → sentence case');
eq(C('call LifeNet re iPhone app'), 'Call LifeNet re iPhone app', 'mixed case kept');
eq(C('Order soil for the Fiddle Leaf'), 'Order soil for the Fiddle Leaf', 'typed capitals never lowered');
eq(C('RENEW HOSPITAL BADGE'), 'Renew hospital badge', 'all caps → lowercased first');
eq(C('EMAIL AMD ABOUT EKG'), 'Email AMD about EKG', 'all caps keeps list words');
eq(C('send edba\'s pdf to amd'), "Send EDBA's PDF to AMD", 'acronyms + possessive');
eq(C('budget (amd), stemi review.'), 'Budget (AMD), STEMI review.', 'acronyms inside punctuation');
eq(C('ask mo and tristen re qi'), 'Ask Mo and Tristen re QI', 'names + mixed-case list words');
eq(C('ed shift swap'), 'ED shift swap', 'list word as first word');
eq(C('Ed shift swap'), 'ED shift swap', 'list word in any case');
eq(C('call the medic'), 'Call the medic', 'list word inside a longer word untouched');
eq(C('redo cvs and emsley notes'), 'Redo cvs and emsley notes', 'no partial-word matches');
eq(C('iPhone backup'), 'iPhone backup', 'first word with an inner capital kept');
eq(C('(nyp) badge'), '(NYP) badge', 'leading punctuation');
eq(C('3 ekg reads'), '3 EKG reads', 'leading digit');
eq(C(''), '', 'empty');
eq(C('x'), 'X', 'one character');
eq(C('A'), 'A', 'one capital (not caps lock)');
eq(C('OK'), 'Ok', 'two capitals = caps lock');

// ── closeMatch (duplicate hint) ──
const pool = [{ id: '1', title: 'Reply to cardiology about LifeNet' }, { id: '2', title: 'Order soil for the fiddle leaf' }];
eq(P.closeMatch('reply to cardiology', pool)?.id, '1', 'substring match');
eq(P.closeMatch('Order soil for fiddle leaf', pool)?.id, '2', 'word overlap match');
eq(P.closeMatch('Write the analysis plan', pool), null, 'no match');
eq(P.closeMatch('abc', pool), null, 'too short');
eq(P.closeMatch('REPLY TO CARDIOLOGY', pool)?.id, '1', 'closeMatch is case-insensitive');

console.log(`parse.test.js — ${n} assertions passed`);
