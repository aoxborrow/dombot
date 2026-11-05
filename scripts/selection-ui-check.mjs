// Opt-in UI regression using the built, entirely in-memory demo. No live APIs.
// npm run demo:build
// DOMBOT_UI_QA_TOOLS=/temporary/tools node scripts/selection-ui-check.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

const assets = path.resolve('dist/demo');
const html = await fs.readFile(path.join(assets, 'index.html'), 'utf8');
assert(html.includes('<title>DomBot Demo'), 'Build the synthetic demo first.');
const tools = process.env.DOMBOT_UI_QA_TOOLS;
assert(
  tools && path.isAbsolute(tools),
  'Set DOMBOT_UI_QA_TOOLS to a temporary npm directory containing playwright-core.',
);
const { chromium } = createRequire(path.join(tools, 'package.json'))(
  'playwright-core',
);
const chrome =
  process.env.DOMBOT_UI_QA_CHROME ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(
      new URL(request.url, 'http://localhost').pathname,
    );
    const file = path.resolve(
      assets,
      '.' + (pathname === '/' ? '/index.html' : pathname),
    );
    assert(file.startsWith(assets + path.sep));
    const body = await fs.readFile(file);
    response.writeHead(200, {
      'Content-Type':
        {
          '.html': 'text/html',
          '.js': 'application/javascript',
          '.css': 'text/css',
          '.svg': 'image/svg+xml',
        }[path.extname(file)] ?? 'application/octet-stream',
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
let browser, page;
const passed = [];
async function protect(context) {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort(),
  );
}
try {
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  await protect(context);
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.goto(origin);
  const checks = () => page.locator('tbody [role="checkbox"]');
  await checks().first().waitFor();
  assert((await checks().count()) > 1);
  const nameOf = async (checkbox) =>
    (await checkbox.getAttribute('aria-label')).slice('Select '.length);
  const first = await nameOf(checks().first()),
    second = await nameOf(checks().nth(1));
  const clear = () =>
    page.getByRole('button', { name: 'Clear selection', exact: true });
  const search = page.getByRole('searchbox');
  const count = async () =>
    (await clear().locator('..').innerText()).replace(/\s+/g, ' ').trim();
  async function openAction(name) {
    await page.getByRole('button', { name: 'Actions', exact: true }).click();
    await page
      .getByRole('menuitem', {
        name: new RegExp('^' + name + '(?:\\s*…)?(?:\\s*\\d+)?$'),
      })
      .click();
    await page.getByRole('dialog').waitFor();
  }
  async function oneDialog(name) {
    const text = await page.getByRole('dialog').innerText();
    assert(text.includes(name), text);
    assert(!/\d+\s+domains:/.test(text), text);
  }
  async function cancel() {
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  async function pick(name) {
    await page
      .getByRole('checkbox', { name: 'Select ' + name, exact: true })
      .click();
  }

  await page.locator('thead [role="checkbox"]').click();
  assert.match(await count(), /selected/);
  await search.fill(first);
  await page.waitForFunction(
    () => document.querySelectorAll('tbody [role="checkbox"]').length === 1,
  );
  assert.equal(
    await clear().count(),
    0,
    'A filter change must clear previous hidden targets.',
  );
  await pick(first);
  await openAction('Pricing');
  await oneDialog(first);
  await cancel();
  passed.push('select all → filter → single pricing target');

  await page.evaluate(() => {
    window.selectionWrites = [];
    for (const name of ['setListPrices', 'setNotes', 'assignFolder']) {
      const original = window.api[name];
      window.api[name] = async (...args) => {
        window.selectionWrites.push({ name, args });
        return original(...args);
      };
    }
  });
  await openAction('Pricing');
  await page.locator('#bin-price').fill('123');
  await page.locator('#list-min-offer').fill('');
  await page.locator('#list-floor').fill('');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  const prices = await page.evaluate(() =>
    window.selectionWrites.filter((w) => w.name === 'setListPrices'),
  );
  assert.deepEqual(
    prices.map((w) => w.args[0].map((row) => row.domainName)),
    [[first]],
  );
  await openAction('Notes');
  await oneDialog(first);
  await page
    .getByRole('textbox', { name: 'Notes', exact: true })
    .fill('Synthetic selection check');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert.deepEqual(
    await page.evaluate(() =>
      window.selectionWrites
        .filter((w) => w.name === 'setNotes')
        .map((w) => w.args[0]),
    ),
    [first],
  );
  passed.push('pricing and notes save only the selected name');

  await page.evaluate(() => {
    const original = window.api.assignFolder;
    window.api.assignFolder = async (...args) => {
      await original(...args);
      await new Promise((resolve) => {
        window.releaseSelectionFolder = resolve;
      });
    };
  });
  await page
    .locator('button[aria-haspopup="menu"]:not([data-chip-trigger])')
    .filter({ hasText: /^Folder/ })
    .click();
  await page.getByRole('menuitem', { name: /^None/ }).click();
  await page.waitForFunction(
    () => typeof window.releaseSelectionFolder === 'function',
  );
  await search.fill(second);
  await pick(second);
  await page.evaluate(() => window.releaseSelectionFolder());
  await openAction('Pricing');
  await oneDialog(second);
  await cancel();
  assert.deepEqual(
    await page.evaluate(() =>
      window.selectionWrites
        .filter((w) => w.name === 'assignFolder')
        .map((w) => w.args[0]),
    ),
    [first],
  );
  passed.push('late folder completion preserves a new filter selection');

  await search.fill('');
  await page.waitForFunction(
    () => document.querySelectorAll('tbody [role="checkbox"]').length > 1,
  );
  await pick(first);
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  const nextPage = await nameOf(checks().first());
  await pick(nextPage);
  assert.match(await count(), /^2\b/);
  await page.getByRole('button', { name: /^Domain$/i, exact: true }).click();
  assert.match(
    await count(),
    /^2\b/,
    'Sorting must preserve deliberate cross-page selection.',
  );
  await openAction('Pricing');
  const two = await page.getByRole('dialog').innerText();
  assert(
    two.includes(first) && two.includes(nextPage) && /2\s+domains:/.test(two),
    two,
  );
  await cancel();
  passed.push('pagination and sorting preserve the two explicit targets');
  await page.getByRole('button', { name: /^Domain$/i, exact: true }).click();

  await search.fill(first);
  await pick(first);
  await search.fill('');
  await page
    .getByRole('checkbox', { name: 'Select ' + second, exact: true })
    .click({ modifiers: ['Shift'] });
  assert.match(
    await count(),
    /^1\b/,
    'Changing filters must reset the shift anchor.',
  );
  passed.push('shift anchor resets with the filter');
  await page
    .getByRole('link', { name: /^Renewals/ })
    .first()
    .click();
  await page
    .getByRole('heading', { name: /^Renewals/ })
    .first()
    .waitFor();
  await page
    .getByRole('link', { name: /^Domains/ })
    .first()
    .click();
  await checks().first().waitFor();
  assert.equal(await clear().count(), 0);
  await pick(first);
  await openAction('Pricing');
  await page.goto(origin + '/#/?view=archive');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert.equal(await clear().count(), 0);
  await page.goto(origin + '/#/');
  await checks().first().waitFor();
  assert.equal(await clear().count(), 0);
  passed.push('navigation/archive clear selection and pending dialogs');

  await page
    .getByRole('link', { name: /^Activity/ })
    .first()
    .click();
  await page
    .getByRole('heading', { name: /^Activity/ })
    .first()
    .waitFor();
  await checks().first().waitFor();
  const eventName = (await checks().first().getAttribute('aria-label')).split(
    ' ',
  )[1];
  await page.locator('thead [role="checkbox"]').click();
  await page.getByRole('searchbox').fill(eventName);
  assert.equal(await clear().count(), 0);
  await checks().first().click();
  await openAction('Notes');
  await oneDialog(eventName);
  await cancel();
  passed.push('Activity filters scope its bulk targets');

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
  });
  await protect(mobile);
  const touch = await mobile.newPage();
  await touch.goto(origin);
  await touch.locator('tbody [role="checkbox"]').first().waitFor();
  await touch.locator('thead [role="checkbox"]').tap();
  await touch.getByRole('searchbox').fill(first);
  await touch.waitForFunction(
    () => document.querySelectorAll('tbody [role="checkbox"]').length === 1,
  );
  assert.equal(
    await touch
      .getByRole('button', { name: 'Clear selection', exact: true })
      .count(),
    0,
  );
  await touch.locator('tbody [role="checkbox"]').first().tap();
  assert.equal(
    await touch
      .locator('tbody [role="checkbox"][data-state="checked"]')
      .count(),
    1,
  );
  await mobile.close();
  passed.push('mobile touch selection after filtering');
  console.log(JSON.stringify({ passed: passed.length, cases: passed }));
} catch (error) {
  if (page)
    console.error((await page.locator('body').innerText()).slice(0, 4000));
  throw error;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
