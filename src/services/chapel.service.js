/**
 * St. Andrew Chapel availability: there is one chapel, so one wake at a time. The days each
 * accepted wake has it are worked out the same way as admin-web's and the apps'
 * src/lib/shared/funeral-rules.ts (chapelStayOf); tests/chapel.test.js checks the same cases.
 *
 * A wake has the chapel from its first day there (the Start of Mourning, or `chapelFrom` when it
 * starts at home) through its Last Night; the burial day is free. While its burial is to be
 * announced it keeps the chapel (no end yet). Only accepted wakes count (In Progress, or Completed,
 * which means fully paid, not that the wake is over); a request waiting for review doesn't.
 *
 * Families get only the days, never who or which case.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A day as "YYYY-MM-DD" in the Philippines, from a day string, Firestore Timestamp or Date. */
function dayOf(value) {
  if (!value) return '';
  if (typeof value === 'string') return DAY.test(value.trim()) ? value.trim() : '';
  const date = typeof value.toDate === 'function' ? value.toDate() : value instanceof Date ? value : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + n));
  return date.toISOString().slice(0, 10);
}

/** The days a wake has the chapel ({ from, to }; to null while its burial is TBA), or null. */
function chapelStayOf({ viewing, startOfMourning, chapelFrom = '', lastNight = '', burial = '', burialTBA = false }) {
  if (viewing !== 'chapel' || !DAY.test(startOfMourning || '')) return null;
  const from = DAY.test(chapelFrom) && chapelFrom > startOfMourning ? chapelFrom : startOfMourning;
  if (burialTBA) return { from, to: null };
  const night = DAY.test(lastNight) ? lastNight : DAY.test(burial) ? addDays(burial, -1) : '';
  if (!night) return { from, to: null };
  return night < from ? null : { from, to: night };
}

const ACCEPTED = ['in_progress', 'accepted', 'approved', 'completed'];
const statusOf = (v) => String(v || '').toLowerCase().trim().replace(/[\s-]+/g, '_');

/** Whether a case's wake is accepted: its request is In Progress or Completed (or the case was accepted). */
function isAccepted(caseData, request) {
  if (caseData.isCompleted === true && !request) return true;
  if (request) return ACCEPTED.includes(statusOf(request.status));
  const status = statusOf(caseData.status);
  if (status) return ACCEPTED.includes(status);
  return caseData.requestStatus === 'Accepted';
}

/** The chapel stays of accepted wakes that aren't over yet (`to` today or later, or no end), earliest first. */
function chapelStays(cases, requests, today) {
  const byId = new Map(requests.map((r) => [r.id, r.data]));
  const byRef = new Map(requests.filter((r) => r.data.referenceCode).map((r) => [r.data.referenceCode, r.data]));
  const stays = [];
  for (const { id, data } of cases) {
    if (data.planKind === 'preNeed' && data.lifecycleStatus !== 'Claimed') continue; // the holder is alive
    const request = byId.get(id) || (data.referenceNumber ? byRef.get(data.referenceNumber) : undefined);
    if (!isAccepted(data, request)) continue;
    const stay = chapelStayOf({
      viewing: data.viewingPreference || request?.viewingPreference || '',
      startOfMourning: dayOf(data.startOfMourning) || dayOf(request?.wakeSchedule?.startOfMourning),
      chapelFrom: dayOf(data.chapelFrom) || dayOf(request?.chapelFrom),
      lastNight: dayOf(data.lastNight) || dayOf(request?.wakeSchedule?.lastNight),
      burial: dayOf(data.funeralDate) || dayOf(request?.burialDate),
      burialTBA: data.burialTBA === true,
    });
    if (stay && (stay.to === null || stay.to >= today)) stays.push(stay);
  }
  return stays.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

/**
 * Factory so tests can pass a fake Firestore and clock.
 * @param {{ db: any, now?: () => Date, cacheMs?: number }} deps
 */
function createChapelService({ db, now = () => new Date(), cacheMs = 60_000 }) {
  let cached = null;
  return {
    /** The chapel's stays from today on (cached briefly: every family's form asks). */
    async availability() {
      const at = now().getTime();
      if (cached && at - cached.at < cacheMs) return cached.value;
      const today = dayOf(now());
      const [casesSnap, requestsSnap] = await Promise.all([db.collection('pre_plans').get(), db.collection('transactions').get()]);
      const value = {
        today,
        stays: chapelStays(
          casesSnap.docs.map((d) => ({ id: d.id, data: d.data() })),
          requestsSnap.docs.map((d) => ({ id: d.id, data: d.data() })),
          today
        ),
      };
      cached = { at, value };
      return value;
    },
  };
}

module.exports = { chapelStayOf, chapelStays, createChapelService, dayOf };
