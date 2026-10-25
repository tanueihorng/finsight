// The retained classic chart scripts (public/chart.js and its helpers) used to
// be parser-blocking tags in index.html, ahead of the app module. Only the
// detail chart and its grid need them, so they now load once the browser is
// idle after startup (H1), keeping them out of the way of the first render, in
// their old order, once per page. A failed load stays failed until a reload,
// as a failed script tag did.
const FILES = ['/indicators.js', '/strategy.js', '/strategies.js', '/chart.js', '/chartgrid.js', '/journal.js'];
let loading: Promise<void> | undefined;
const idle = () => new Promise<void>((done) => {
  if ('requestIdleCallback' in window) requestIdleCallback(() => done(), { timeout: 500 });
  else setTimeout(done, 50);
});

export function loadChartScripts(): Promise<void> {
  loading ??= idle().then(() => Promise.all(FILES.map((src) => new Promise<void>((done, fail) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = false; // execute in list order, as the old tags did
    s.onload = () => done();
    s.onerror = () => fail(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  })))).then(() => {});
  return loading;
}
