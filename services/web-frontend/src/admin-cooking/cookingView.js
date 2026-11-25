import { formatWait } from '../home/congestionApi.js';
export const cookingDuration = (seconds) =>
  seconds == null ? '—' : formatWait(seconds);
export const cookingNumber = (value) =>
  value == null ? '—' : value.toLocaleString('ko-KR');
export function cookingKst(value) {
  if (value == null) return '—';
  return `${new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(value))} KST`;
}
export function cookingDisagreement(resources) {
  const { overview, congestion, queue } = resources;
  const o = overview.data,
    c = congestion.data,
    q = queue.data;
  return !!(
    (o && q && o.waitingCount !== q.count) ||
    (o &&
      c &&
      ['waitingCount', 'cookingCount', 'expectedWaitSec'].some(
        (key) => o[key] !== c[key],
      ))
  );
}
