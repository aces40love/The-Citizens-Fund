import assert from 'node:assert/strict';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Run with the local preview server already running: npm start, then npm test.
// Override BASE_URL or PLAYWRIGHT_CHROMIUM_EXECUTABLE when necessary.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const previewDir = path.join(root, 'previews');
const baseURL = process.env.BASE_URL || 'http://127.0.0.1:4173';
const origin = new URL(baseURL).origin;
const failures = [];
const results = [];
const network = [];
const runtimeErrors = [];
await mkdir(previewDir, { recursive: true });

async function browserExecutable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  try { await access(chromium.executablePath()); return undefined; } catch {}
  // Use an existing Mac cache when the package and browser revisions differ.
  const cache = path.join(homedir(), 'Library/Caches/ms-playwright');
  for (const entry of (await readdir(cache).catch(() => [])).sort().reverse()) {
    if (!entry.startsWith('chromium_headless_shell-')) continue;
    for (const arch of ['arm64', 'x64']) {
      const executable = path.join(cache, entry, `chrome-headless-shell-mac-${arch}`, 'chrome-headless-shell');
      try { await access(executable); return executable; } catch {}
    }
  }
  return undefined;
}

const browser = await chromium.launch({ headless: true, executablePath: await browserExecutable() });
const context = await browser.newContext({ acceptDownloads: true, reducedMotion: 'reduce' });
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) {
    network.push({ external: true, url: url.href, method: route.request().method() });
    return route.abort();
  }
  return route.continue();
});
context.on('request', request => {
  const url = new URL(request.url());
  if (['http:', 'https:'].includes(url.protocol)) network.push({ url: url.href, method: request.method() });
});
context.on('page', page => {
  page.on('pageerror', error => runtimeErrors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400) runtimeErrors.push(`${response.status()} ${response.url()}`);
  });
});

async function run(name, task) {
  try {
    await task();
    results.push({ name, status: 'passed' });
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, error: error.message });
    results.push({ name, status: 'failed', error: error.message });
    console.error(`FAIL ${name}\n${error.stack || error.message}`);
  }
}

async function noOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth,
    overflowing: [...document.querySelectorAll('body *')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width && r.left >= 0 && r.right > innerWidth + 1 && getComputedStyle(el).position !== 'fixed';
    }).slice(0, 8).map(el => `${el.tagName}.${el.className}`)
  }));
  assert(dimensions.document <= dimensions.viewport + 1, `${label}: horizontal overflow ${JSON.stringify(dimensions)}`);
}

async function accessible(page, label) {
  const report = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const violations = report.violations.map(v => ({ id: v.id, impact: v.impact, description: v.description,
    nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) }));
  await writeFile(path.join(previewDir, `accessibility-${label}.json`), JSON.stringify(violations, null, 2));
  assert.deepEqual(violations, [], `${label}: accessibility violations ${JSON.stringify(violations, null, 2)}`);
}

try {
  for (const [label, width, height] of [['desktop', 1440, 1000], ['tablet', 768, 1024], ['mobile', 390, 844], ['narrow', 320, 740]]) {
    const page = await context.newPage();
    await page.setViewportSize({ width, height });
    await page.goto(baseURL);
    await page.evaluate(() => document.fonts.ready);
    // Scroll through lazy images, then return to the hero before capturing.
    await page.locator('.local-image img').scrollIntoViewIfNeeded();
    await expect(page.locator('.local-image img')).toHaveJSProperty('complete', true);
    await page.evaluate(() => scrollTo(0, 0));
    await run(`${label}: layout, images, fonts, and anchor targets`, async () => {
      await noOverflow(page, label);
      const brokenImages = await page.locator('img').evaluateAll(images => images.filter(img => !img.complete || !img.naturalWidth).map(img => img.src));
      assert.deepEqual(brokenImages, []);
      const fonts = await page.evaluate(() => [...document.fonts].map(font => ({ family: font.family, status: font.status })));
      assert(fonts.some(font => font.family === 'Libre Caslon' && font.status === 'loaded'));
      assert(fonts.some(font => font.family === 'DM Sans' && font.status === 'loaded'));
      const brokenAnchors = await page.locator('a[href^="#"]').evaluateAll(links => links
        .map(link => link.getAttribute('href')).filter(href => href.length > 1 && !document.getElementById(decodeURIComponent(href.slice(1)))));
      assert.deepEqual(brokenAnchors, []);
    });
    await run(`${label}: WCAG accessibility`, () => accessible(page, label));
    if (label === 'desktop' || label === 'mobile') {
      await page.screenshot({ path: path.join(previewDir, `${label}.png`), fullPage: true });
      await page.screenshot({ path: path.join(previewDir, `${label}-hero.png`) });
    }
    if (width < 961) {
      await run(`${label}: mobile navigation opens, closes, anchors, Escape`, async () => {
        const toggle = page.locator('.menu-toggle');
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('#mobile-nav')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(toggle).toBeFocused();
        await toggle.click();
        await page.locator('#mobile-nav a[href="#focus"]').click();
        await expect(page).toHaveURL(`${baseURL}/#focus`);
        await expect(page.locator('#mobile-nav')).toBeHidden();
        await toggle.click();
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      });
      await run(`${label}: inquiry fits and Escape unlocks the page`, async () => {
        await page.locator('#housing [data-open-inquiry]').click();
        await expect(page.locator('#inquiry-dialog')).toBeVisible();
        await noOverflow(page, `${label} inquiry`);
        const geometry = await page.locator('#inquiry-dialog').evaluate(dialog => ({ width: dialog.clientWidth, content: dialog.scrollWidth }));
        assert(geometry.content <= geometry.width + 1, `Dialog overflow: ${JSON.stringify(geometry)}`);
        await accessible(page, `${label}-inquiry`);
        await page.keyboard.press('Escape');
        await expect(page.locator('#inquiry-dialog')).not.toBeVisible();
        await expect(page.locator('body')).not.toHaveClass(/dialog-open/);
        await expect(page.locator('#housing [data-open-inquiry]')).toBeFocused();
        await page.locator('.menu-toggle').click();
        await page.locator('#mobile-nav [data-open-inquiry]').click();
        await expect(page.locator('#mobile-nav')).toBeHidden();
        await page.keyboard.press('Escape');
        await expect(page.locator('.menu-toggle')).toBeFocused();
      });
    }
    await page.close();
  }

  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(baseURL);
  await run('Inquiry: full validation, conditional fields, retained answers, safe review, local download', async () => {
    const dialog = page.locator('#inquiry-dialog');
    const next = page.locator('[data-inquiry-next]');
    const back = page.locator('[data-inquiry-back]');
    await page.locator('#housing [data-open-inquiry]').click();
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: path.join(previewDir, 'inquiry.png') });
    await accessible(page, 'desktop-inquiry');
    await next.click();
    for (const name of ['organization', 'organizationType', 'contact', 'role', 'email', 'phone']) {
      await expect(page.locator(`#error-${name}`)).toBeVisible();
    }
    await expect(page.locator('#inquiry-organization')).toBeFocused();
    const malicious = '<img src=x onerror="window.__unsafe = true">';
    await page.locator('[name="organization"]').fill(malicious);
    await page.locator('[name="organizationType"][value="Other"]').check();
    await expect(page.locator('[name="organizationOther"]')).toBeVisible();
    for (const [name, value] of Object.entries({ contact: 'Jordan Example', role: 'Director', email: 'not-an-email', phone: '615-555-0100' })) {
      await page.locator(`[name="${name}"]`).fill(value);
    }
    await next.click();
    await expect(page.locator('#error-organizationOther')).toBeVisible();
    await expect(page.locator('#error-email')).toContainText('valid email');
    await page.locator('[name="organizationOther"]').fill('Neighborhood coalition');
    await page.locator('[name="email"]').fill('jordan@example.org');
    await next.click();
    await expect(page.locator('[data-step="1"]')).toBeVisible();
    await expect(page.locator('[name="focus"][value="Affordable Housing"]')).toBeChecked();
    await page.locator('[name="focus"][value="Affordable Housing"]').uncheck();
    await next.click();
    for (const name of ['focus', 'description', 'community']) await expect(page.locator(`#error-${name}`)).toBeVisible();
    await page.locator('[name="focus"][value="Affordable Housing"]').check();
    await page.locator('#inquiry-description').fill('We help Nashville neighbors find stable housing.');
    await page.locator('[name="community"]').fill('Families in North Nashville.');
    await back.click();
    await expect(page.locator('[name="organization"]')).toHaveValue(malicious);
    await expect(page.locator('[name="organizationOther"]')).toHaveValue('Neighborhood coalition');
    await page.locator('[name="organizationType"][value="Nonprofit"]').check();
    await page.locator('[name="organizationType"][value="Other"]').uncheck();
    await expect(page.locator('[name="organizationOther"]')).toBeHidden();
    await expect(page.locator('[name="organizationOther"]')).toBeDisabled();
    await next.click();
    await expect(page.locator('#inquiry-description')).toHaveValue('We help Nashville neighbors find stable housing.');
    await next.click();
    await next.click();
    for (const name of ['project', 'support', 'funding']) await expect(page.locator(`#error-${name}`)).toBeVisible();
    await page.locator('[name="project"]').fill('Renovate neighborhood homes for long-term affordability.');
    await page.locator('[name="support"]').selectOption('Other');
    await page.locator('[name="funding"]').selectOption({ label: '$25,000–$100,000' });
    await next.click();
    await expect(page.locator('#error-supportOther')).toBeVisible();
    await page.locator('[name="supportOther"]').fill('Volunteer expertise');
    await next.click();
    await next.click();
    for (const name of ['impact', 'geography', 'stage']) await expect(page.locator(`#error-${name}`)).toBeVisible();
    await page.locator('[name="impact"]').fill('More neighbors have safe, stable homes.');
    await page.locator('[name="geography"]').fill('North Nashville');
    await page.locator('[name="stage"]').selectOption('Planning');
    await page.locator('[name="timeline"]').fill('2027');
    await page.locator('[name="additional"]').fill('Community-led work.');
    await next.click();
    await expect(page.locator('#inquiry-review')).toBeVisible();
    await expect(page.locator('#inquiry-review-title')).toBeFocused();
    await expect(page.locator('#inquiry-summary')).toContainText(malicious);
    await expect(page.locator('#inquiry-summary')).toContainText('Volunteer expertise');
    await expect(page.locator('#inquiry-summary')).not.toContainText('Neighborhood coalition');
    assert.equal(await page.locator('#inquiry-summary img').count(), 0);
    assert.equal(await page.evaluate(() => window.__unsafe), undefined);
    await accessible(page, 'inquiry-review');
    const downloaded = page.waitForEvent('download');
    await page.locator('[data-inquiry-download]').click();
    const download = await downloaded;
    assert.equal(download.suggestedFilename(), 'citizens-fund-inquiry.txt');
    const content = await readFile(await download.path(), 'utf8');
    for (const expected of [malicious, 'Jordan Example', 'jordan@example.org', 'Affordable Housing', 'Volunteer expertise', 'North Nashville', 'not been submitted']) assert(content.includes(expected));
    await page.locator('[data-inquiry-edit]').click();
    await expect(page.locator('[name="organization"]')).toHaveValue(malicious);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('body')).not.toHaveClass(/dialog-open/);
    await page.locator('#housing [data-open-inquiry]').click();
    await expect(page.locator('[name="organization"]')).toHaveValue(malicious);
    await page.locator('[data-close-inquiry]').click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('body')).toHaveCSS('overflow', 'visible');
  });
  await run('Direct file opening: styles, images, local fonts, and inquiry work without a server', async () => {
    const localPage = await context.newPage();
    try {
      await localPage.goto(pathToFileURL(path.join(root, 'index.html')).href);
      await localPage.evaluate(() => document.fonts.ready);
      await localPage.locator('.local-image img').scrollIntoViewIfNeeded();
      await expect(localPage.locator('.local-image img')).toHaveJSProperty('complete', true);
      const brokenImages = await localPage.locator('img').evaluateAll(images => images.filter(img => !img.complete || !img.naturalWidth).map(img => img.src));
      assert.deepEqual(brokenImages, []);
      const fonts = await localPage.evaluate(() => [...document.fonts].map(font => ({ family: font.family, status: font.status })));
      assert(fonts.some(font => font.family === 'Libre Caslon' && font.status === 'loaded'));
      assert(fonts.some(font => font.family === 'DM Sans' && font.status === 'loaded'));
      assert((await localPage.locator('h1').evaluate(el => getComputedStyle(el).fontFamily)).includes('Libre Caslon'));
      await localPage.locator('#housing [data-open-inquiry]').click();
      await expect(localPage.locator('#inquiry-dialog')).toBeVisible();
      await localPage.locator('[data-inquiry-next]').click();
      await expect(localPage.locator('#error-organization')).toBeVisible();
      await localPage.keyboard.press('Escape');
      await expect(localPage.locator('#inquiry-dialog')).not.toBeVisible();
    } finally { await localPage.close(); }
  });
  await run('No browser errors, failed assets, external requests, or submissions', async () => {
    assert.deepEqual(runtimeErrors, []);
    assert.deepEqual(network.filter(request => request.external || new URL(request.url).origin !== origin || !['GET', 'HEAD'].includes(request.method)), []);
  });
  await page.close();
} finally {
  await browser.close();
  await writeFile(path.join(previewDir, 'test-results.json'), JSON.stringify({ results, failures, requests: network.length }, null, 2));
}
console.log(`\n${results.length - failures.length}/${results.length} checks passed.`);
if (failures.length) process.exitCode = 1;
