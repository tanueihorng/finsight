// Browser-only feedback. Timings, oscillator and notification permission match
// legacy app.js; the owner cleans nodes, timers and audio on island removal.
export function createNotifier() {
  const timers = new Set<number>(), nodes = new Set<HTMLElement>(), audio = new Set<AudioContext>();
  const later = (fn: () => void, ms: number) => { const id = window.setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };
  return {
    notify(head: string, body: string) {
      const el = document.createElement('div'); el.className = 'toast';
      const h = document.createElement('div'); h.className = 'toast-h'; h.textContent = '🔔 ' + head;
      const b = document.createElement('div'); b.className = 'toast-b'; b.textContent = body;
      el.append(h, b); document.getElementById('toasts')?.append(el); nodes.add(el);
      later(() => { el.style.transition = 'opacity .4s'; el.style.opacity = '0'; later(() => { el.remove(); nodes.delete(el); }, 400); }, 9000);
      try {
        const Audio = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Audio(); audio.add(ctx);
        const o = ctx.createOscillator(), g = ctx.createGain(); o.connect(g); g.connect(ctx.destination);
        o.type = 'sine'; o.frequency.value = 880; g.gain.value = .05; o.start(); o.stop(ctx.currentTime + .15);
        o.onended = () => { void ctx.close(); audio.delete(ctx); };
      } catch {}
      if ('Notification' in window && Notification.permission === 'granted') { try { new Notification(head, { body }); } catch {} }
    },
    dispose() {
      timers.forEach((id) => clearTimeout(id)); timers.clear(); nodes.forEach((node) => node.remove()); nodes.clear();
      audio.forEach((ctx) => { try { void ctx.close(); } catch {} }); audio.clear();
    },
  };
}
