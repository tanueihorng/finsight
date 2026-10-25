import type { Alert } from '../../../../shared/types.ts';
// Existing triggered alerts seed the set silently. Subsequent ids fire once.
export function createTriggerTracker() {
  let notified: Set<string> | null = null;
  return (alerts: Alert[]): Alert[] => {
    if (notified === null) { notified = new Set(alerts.filter((a) => a.triggeredAt).map((a) => a.id)); return []; }
    return alerts.filter((a) => {
      if (!a.met || !a.triggeredAt || notified!.has(a.id)) return false;
      notified!.add(a.id); return true;
    });
  };
}
