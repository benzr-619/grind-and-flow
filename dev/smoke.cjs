// dev/smoke.cjs — headless smoke test. Boots the real app (index.html) against
// dev/fake-supabase.js + a seed fixture, runs an optional scenario, and fails on
// any console error / page error.
//   NODE_PATH=<dir with playwright> node dev/smoke.cjs [scenario.cjs] [--mobile]
// Expects the repo served at http://localhost:8765/grind-and-flow/ (see dev/serve.sh).
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
(async () => {
  const args = process.argv.slice(2);
  const mobile = args.includes('--mobile');
  const scen = args.find(a => !a.startsWith('--'));
  const scenario = scen ? require(path.resolve(scen)) : null;
  const seed = scenario && scenario.seed ? scenario.seed() : {};
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1360, height: 900 }, hasTouch: mobile, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.addInitScript(s => { window.__FAKE_DB = s; }, seed);
  const fake = fs.readFileSync(path.join(__dirname, 'fake-supabase.js'), 'utf8');
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/**', r => r.fulfill({ contentType: 'application/javascript', body: fake }));
  // Block other external hosts (fonts/icons) so runs are deterministic and offline-safe.
  await page.route(/^https?:\/\/(?!localhost)/, r => r.request().url().includes('@supabase') ? r.fallback() : r.abort());
  await page.goto('http://localhost:8765/grind-and-flow/');
  await page.waitForTimeout(800);
  const realErrors = () => errors.filter(e => !/net::ERR_FAILED|Failed to load resource/.test(e));
  try {
    if (scenario && scenario.run) await scenario.run(page, { mobile });
  } catch (e) { errors.push('scenario: ' + e.message); }
  const shotDir = process.env.SHOT_DIR || __dirname;
  await page.screenshot({ path: path.join(shotDir, 'smoke' + (mobile ? '-mobile' : '') + '.png'), fullPage: false });
  const errs = realErrors();
  await browser.close();
  if (errs.length) { console.log('FAIL\n' + errs.join('\n')); process.exit(1); }
  console.log('OK — no console errors');
})();
