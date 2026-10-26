// PIN lock texts and checks (F9), ported from public/app.js S34.
export type LockMode = 'enter' | 'create' | 'offline';
export const lockTitle = (mode: LockMode) =>
  mode === 'create' ? 'Create a PIN (4–12 digits)' : mode === 'offline' ? "Can't reach the FinSight server" : 'Enter your PIN';
export const OFFLINE_MSG = 'Start it with  node server.ts  (or start.command). Retrying…';
// The reason a PIN can't be submitted yet, or null.
export function pinProblem(mode: LockMode, pin: string, pin2: string): string | null {
  if (!/^\d{4,12}$/.test(pin)) return 'PIN must be 4–12 digits';
  if (mode === 'create' && pin !== pin2) return 'PINs do not match';
  return null;
}
