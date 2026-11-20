const { chromium } = require('playwright');
const [,, url, outDir, fps = '30', dur = '15', only] = process.argv;
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  p.on('console', m => console.log('console:', m.text()));
  p.on('pageerror', e => console.log('pageerror:', e.message));
  await p.goto(url);
  await p.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
  await p.evaluate(() => document.fonts.ready);
  const times = only ? only.split(',').map(Number) : [...Array(Math.round(+fps * +dur)).keys()].map(i => i / +fps);
  for (let i = 0; i < times.length; i++) {
    await p.evaluate(t => window.renderAt(t), times[i]);
    await p.screenshot({ path: `${outDir}/f_${String(i).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 92 });
    if (i % 50 === 0) console.log('frame', i, '/', times.length);
  }
  await b.close();
})();
