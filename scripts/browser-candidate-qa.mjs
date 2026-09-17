import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}

const base = arg('--base-url', 'http://127.0.0.1:8787').replace(/\/$/, '');
const outputDir = path.resolve(arg('--output-dir', '/mnt/d/tmp/plumbob/ushso-audit-remediation-20260906/browser-qa-final'));
const debugPort = Number(arg('--debug-port', '9224'));
await fs.mkdir(outputDir, { recursive: true });
const profile = path.join(outputDir, 'chrome-profile');

const chrome = spawn('/usr/bin/google-chrome', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank'
], { stdio: ['ignore', 'pipe', 'pipe'] });
let diagnostics = '';
for (const stream of [chrome.stdout, chrome.stderr]) stream.on('data', chunk => { diagnostics = `${diagnostics}${chunk}`.slice(-8000); });

async function pollJson(url, init) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (chrome.exitCode !== null) throw new Error(`Chrome exited ${chrome.exitCode}: ${diagnostics}`);
    try {
      const response = await fetch(url, init);
      if (response.ok) return response.json();
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Chrome DevTools did not become ready: ${diagnostics}`);
}

await pollJson(`http://127.0.0.1:${debugPort}/json/version`);

async function openPage(url, width, height) {
  // Create a blank target, attach listeners, then navigate exactly once. If the
  // target is created with the destination URL first, its initial load event
  // can race the explicit navigation and make an otherwise rendered SPA look
  // permanently incomplete to the harness.
  const target = await pollJson(`http://127.0.0.1:${debugPort}/json/new`, { method: 'PUT' });
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let messageId = 0;
  const pending = new Map();
  const listeners = new Map();
  const runtimeDiagnostics = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') runtimeDiagnostics.push({ type: 'exception', detail: message.params?.exceptionDetails?.text ?? 'Runtime exception' });
    if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(message.params?.type)) {
      runtimeDiagnostics.push({ type: message.params.type, detail: (message.params.args ?? []).map(argument => argument.value ?? argument.description ?? '').join(' ') });
    }
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
    }
    for (const resolve of listeners.get(message.method) ?? []) resolve(message.params);
    listeners.delete(message.method);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++messageId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const event = method => new Promise(resolve => listeners.set(method, [...(listeners.get(method) ?? []), resolve]));
  await send('Page.enable');
  await send('Runtime.enable');
  // Keep the CSS layout viewport exact. Chrome's mobile page-scale emulation
  // can silently shrink a wider layout into a narrow screenshot and make an
  // overflowing page look as if it passed at 320/390 CSS pixels.
  await send('Emulation.setDeviceMetricsOverride', { width, height, screenWidth: width, screenHeight: height, deviceScaleFactor: 1, mobile: false });
  if (width <= 500) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const loaded = event('Page.loadEventFired');
  await send('Page.navigate', { url });
  await loaded;
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async (expression, timeout = 20_000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Browser condition timed out: ${expression}`);
  };
  return { target, socket, send, evaluate, waitFor, runtimeDiagnostics };
}

async function closePage(page) {
  await fetch(`http://127.0.0.1:${debugPort}/json/close/${page.target.id}`, { method: 'PUT' }).catch(() => {});
  page.socket.close();
}

async function snapshot(name, url, width, height, expectedText) {
  const page = await openPage(url, width, height);
  try {
    await page.waitFor(`document.body && document.body.innerText.includes(${JSON.stringify(expectedText)})`);
  } catch (error) {
    const debugState = await page.evaluate(`({ title: document.title, url: location.href, bodyText: document.body?.innerText ?? '', html: document.body?.innerHTML ?? '' })`);
    await fs.writeFile(path.join(outputDir, `${name}-failure.json`), `${JSON.stringify(debugState, null, 2)}\n`);
    throw error;
  }
  const state = await page.evaluate(`({
    title: document.title,
    url: location.href,
    width: innerWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    overflowElements: [...document.querySelectorAll('*')].flatMap(node => {
      const rect = node.getBoundingClientRect();
      return rect.right > document.documentElement.clientWidth + 1 || rect.left < -1
        ? [{ tag: node.tagName, className: String(node.className), parentClassName: String(node.parentElement?.className ?? ''), text: node.textContent.trim().slice(0, 120), left: rect.left, right: rect.right, width: rect.width, scrollWidth: node.scrollWidth }]
        : [];
    }).slice(0, 12),
    bodyText: document.body.innerText
  })`);
  assert.equal(state.width, width, `${name} CSS viewport ${state.width} differs from requested ${width}`);
  assert.ok(state.scrollWidth <= state.clientWidth && state.bodyScrollWidth <= state.clientWidth, `${name} horizontal overflow document/body ${state.scrollWidth}/${state.bodyScrollWidth} > client ${state.clientWidth}: ${JSON.stringify(state.overflowElements)}`);
  assert.ok(!/vite|webpack|uncaught runtime error/i.test(state.bodyText), `${name} displayed a framework/runtime error overlay`);
  assert.deepEqual(page.runtimeDiagnostics, [], `${name} emitted browser warnings or errors`);
  assert.ok(!state.bodyText.includes('contains,and'));
  assert.ok(!state.bodyText.includes('accessthe'));
  const capture = await page.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  const file = path.join(outputDir, `${name}.png`);
  await fs.writeFile(file, Buffer.from(capture.data, 'base64'));
  await closePage(page);
  return { name, file, title: state.title, url: state.url, viewport: `${width}x${height}`, css_viewport_width: state.width, client_width: state.clientWidth, scroll_width: state.scrollWidth, body_scroll_width: state.bodyScrollWidth, passed: true };
}

async function verifySortAndReceipt(sort, width, height) {
  const question = 'maternal mortality';
  const expectedResponse = await fetch(`${base}/api/discover`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question, page_size: 10, sort })
  });
  assert.equal(expectedResponse.status, 200, `${sort} API response`);
  const expected = await expectedResponse.json();
  const expectedIds = expected.results.map(result => result.record_id);
  const expectedTitles = expected.results.map(result => result.record.title);
  const page = await openPage(`${base}/search?q=${encodeURIComponent(question)}&sort=${sort}`, width, height);
  const downloadDir = path.join(outputDir, `downloads-${sort}-${width}`);
  await fs.mkdir(downloadDir, { recursive: true });
  await page.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir, eventsEnabled: true });
  await page.waitFor(`document.querySelectorAll('[data-result-id]').length === ${expectedIds.length}`, 30_000);
  const rendered = await page.evaluate(`({
    title: document.title,
    cardTitles: [...document.querySelectorAll('[data-result-id] [data-result-region="title"] > a')].map(node => node.textContent.trim()),
    cardStates: [...document.querySelectorAll('[data-result-id] .result-status:first-child strong')].map(node => node.textContent.trim()),
    overlay: /vite|webpack|uncaught runtime error/i.test(document.body.innerText),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth || document.body.scrollWidth > document.documentElement.clientWidth,
    overflowElements: [...document.querySelectorAll('*')].flatMap(node => {
      const rect = node.getBoundingClientRect();
      return rect.right > innerWidth + 1 || rect.left < -1
        ? [{ tag: node.tagName, className: String(node.className), parentClassName: String(node.parentElement?.className ?? ''), text: node.textContent.trim().slice(0, 120), left: rect.left, right: rect.right, width: rect.width, scrollWidth: node.scrollWidth }]
        : [];
    }).slice(0, 12)
  })`);
  assert.deepEqual(rendered.cardTitles, expectedTitles, `${sort} rendered order differs from API order`);
  assert.equal(rendered.overlay, false, `${sort} framework/runtime overlay`);
  assert.equal(rendered.overflow, false, `${sort} horizontal overflow: ${JSON.stringify(rendered.overflowElements)}`);
  assert.deepEqual(page.runtimeDiagnostics, [], `${sort} emitted browser warnings or errors`);
  await page.evaluate(`document.querySelector('.receipt-button').click()`);
  let downloaded;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && !downloaded) {
    const files = (await fs.readdir(downloadDir)).filter(file => !file.endsWith('.crdownload'));
    if (files.length) downloaded = path.join(downloadDir, files[0]);
    else await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(downloaded, `${sort} receipt did not download`);
  const receipt = JSON.parse(await fs.readFile(downloaded, 'utf8'));
  assert.deepEqual(receipt.displayed_ordered_ids, expectedIds, `${sort} receipt order differs from rendered/API order`);
  assert.deepEqual(receipt.citations.map(citation => citation.record_id), expectedIds, `${sort} receipt citation order differs`);
  await closePage(page);
  return { sort, viewport: `${width}x${height}`, result_count: expectedIds.length, first_result_id: expectedIds[0], card_states: rendered.cardStates, receipt_file: downloaded, passed: true };
}

async function clickExample(question, expectedTitle) {
  const page = await openPage(`${base}/`, 1440, 1000);
  await page.waitFor(`document.querySelector('input[role="combobox"]') !== null`);
  const script = `(() => {
    const input = document.querySelector('input[role="combobox"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(question)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`;
  await page.evaluate(script);
  await page.waitFor(`[...document.querySelectorAll('[role="option"]')].some(node => node.innerText === ${JSON.stringify(question)})`);
  await page.evaluate(`[...document.querySelectorAll('[role="option"]')].find(node => node.innerText === ${JSON.stringify(question)}).click()`);
  await page.waitFor(`location.pathname === '/search' && document.body.innerText.includes(${JSON.stringify(expectedTitle)})`, 30_000);
  const result = await page.evaluate(`({ url: location.href, title: document.title, overflow: document.documentElement.scrollWidth > innerWidth })`);
  assert.equal(result.overflow, false, question);
  await closePage(page);
  return { question, expected_title: expectedTitle, ...result, passed: true };
}

const examples = [
  ['CMS HCRIS hospital cost reports by state', 'Hospital Provider Cost Report'],
  ['CDC maternal mortality data', 'VSRR Provisional Maternal Death Counts and Rates'],
  ['What CMS sources describe hospital ownership in Pennsylvania?', 'Hospital Change of Ownership - Owner Information'],
  ['Public-use hospital utilization data', 'National Hospital Ambulatory Medical Care Survey, Public-use data 1992-2022'],
  ['CMS Medicare inpatient hospital utilization', 'CMS Program Statistics - Medicare Inpatient Hospital']
];

let receipt;
try {
  const clickedExamples = [];
  for (const [question, title] of examples) clickedExamples.push(await clickExample(question, title));
  const sortReceipts = [];
  for (const sort of ['canonical_relevance', 'title_asc', 'release_newest', 'observation_latest']) sortReceipts.push(await verifySortAndReceipt(sort, 1440, 1000));
  sortReceipts.push(await verifySortAndReceipt('title_asc', 390, 844));
  // Use the same browser-facing ID emitted by catalogAdapter.detailsUrl; the
  // stable API accepts both this route ID and the full canonical record ID.
  const detailId = encodeURIComponent('cms-data-catalog:data.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17');
  const captures = [
    await snapshot('desktop-home', `${base}/`, 1440, 1000, 'Find the health-systems data'),
    await snapshot('mobile-home-390', `${base}/`, 390, 844, 'Find the health-systems data'),
    await snapshot('desktop-search', `${base}/search?q=${encodeURIComponent(examples[0][0])}`, 1440, 1000, examples[0][1]),
    await snapshot('mobile-search-390', `${base}/search?q=${encodeURIComponent(examples[0][0])}`, 390, 844, examples[0][1]),
    await snapshot('mobile-search-320', `${base}/search?q=${encodeURIComponent(examples[0][0])}`, 320, 800, examples[0][1]),
    await snapshot('desktop-details', `${base}/datasets/${detailId}`, 1440, 1000, 'PRELIMINARY INCLUSION DECISION'),
    await snapshot('mobile-details-390', `${base}/datasets/${detailId}`, 390, 844, 'PRELIMINARY INCLUSION DECISION')
  ];
  receipt = { schema_version: 'ushso-browser-candidate-qa.v1.1.0', generated_at: new Date().toISOString(), base, browser: 'Google Chrome headless', clicked_examples: clickedExamples, sort_receipts: sortReceipts, captures, status: 'PASS' };
  await fs.writeFile(path.join(outputDir, 'browser-qa-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
} finally {
  chrome.kill('SIGTERM');
}
