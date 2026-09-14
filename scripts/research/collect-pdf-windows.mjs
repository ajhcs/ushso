import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { requireResearchPython } from './research-python.mjs';

const exec = promisify(execFile);
export const hash = (b) => createHash('sha256').update(b).digest('hex');

export function assertPdfWindowResumeCompatible({ previous = null, pdfSha256, extractorSha256 }) {
  if (!previous) return true;
  if (previous.pdf_sha256 !== pdfSha256 || previous.extractor_sha256 !== extractorSha256) {
    throw Error('PDF_WINDOW_RESUME_EXTRACTOR');
  }
  if (!Array.isArray(previous.windows) || previous.windows.length > 2048
    || new Set(previous.windows.map((w) => w?.file)).size !== previous.windows.length
    || previous.windows.some((w) => !w || !Number.isSafeInteger(w.start_page) || w.start_page < 1 || !Number.isSafeInteger(w.count) || w.count < 1 || w.count > 8 || w.file !== w.start_page + '-' + w.count + '.json' || !/^[a-f0-9]{64}$/.test(w.sha256))) {
    throw Error('PDF_WINDOW_CHECKPOINT_SHAPE');
  }
  return true;
}

export function mergePdfWindowResults({ previous = null, windows = [] }) {
  const known = new Map((previous?.windows ?? []).map((w) => [w.file, w]));
  const retained = new Map(known);
  for (const result of windows) retained.set(result.file, result);
  const merged = [...retained.values()].sort((a, b) => a.start_page - b.start_page);
  const nextPage = merged.length ? merged.reduce((max, item) => Math.max(max, item.start_page + item.count), 1) : 1;
  const total = previous?.total_pages ?? null;
  return Object.freeze({
    pdf_sha256: previous?.pdf_sha256 ?? null,
    extractor_sha256: previous?.extractor_sha256 ?? null,
    total_pages: total,
    next_page: nextPage,
    completed: total != null && nextPage > total,
    windows: Object.freeze(merged),
    scientific_approval: false,
  });
}

export async function collectPdfWindows(pdf, out) {
  if (!pdf || !out) throw Error('PDF_WINDOW_USAGE');
  await fs.mkdir(out, { recursive: true });
  const stat = await fs.stat(pdf);
  if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw Error('PDF_WINDOW_SOURCE_SIZE');
  const pdfBytes = await fs.readFile(pdf);
  if (pdfBytes.length > 64 * 1024 * 1024) throw Error('PDF_WINDOW_SOURCE_SIZE');
  const pdf_sha256 = hash(pdfBytes);
  const extractor = new URL('./pdf-text-window.py', import.meta.url).pathname;
  const extractor_sha256 = hash(await fs.readFile(extractor));
  let previous = null;
  try {
    const checkpoint = path.join(out, 'resume.json');
    if ((await fs.stat(checkpoint)).size > 2 * 1024 * 1024) throw Error('PDF_WINDOW_CHECKPOINT_SIZE');
    const bytes = await fs.readFile(checkpoint);
    if (bytes.length > 2 * 1024 * 1024) throw Error('PDF_WINDOW_CHECKPOINT_SIZE');
    previous = JSON.parse(bytes);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  assertPdfWindowResumeCompatible({ previous, pdfSha256: pdf_sha256, extractorSha256: extractor_sha256 });
  const known = new Map((previous?.windows ?? []).map((w) => [w.file, w]));
  let start = 1, total = null, results = [];
  while (total === null || start <= total) {
    const count = total === null ? 1 : Math.min(8, total - start + 1);
    const file = path.join(out, start + '-' + count + '.json');
    let body;
    try {
      if ((await fs.stat(file)).size > 8 * 1024 * 1024) throw Error('PDF_WINDOW_CACHE_SIZE');
      body = await fs.readFile(file, 'utf8');
      if (Buffer.byteLength(body) > 8 * 1024 * 1024) throw Error('PDF_WINDOW_CACHE_SIZE');
      if (known.get(path.basename(file))?.sha256 !== hash(body)) throw Error('PDF_WINDOW_RESUME_HASH');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      const { stdout } = await exec(requireResearchPython(), ['-I', extractor, pdf, String(start), String(count)], { timeout: 25000, maxBuffer: 9 * 1024 * 1024 });
      body = stdout;
      await fs.writeFile(file, body, { flag: 'wx' });
    }
    const captured = JSON.parse(body);
    if (captured.status !== 'captured_window' || captured.pdf_sha256 !== pdf_sha256 || captured.start_page !== start || captured.count !== count || !Array.isArray(captured.pages) || captured.pages.length !== count || !Number.isSafeInteger(captured.total_pages) || captured.total_pages < 1 || captured.total_pages > 2048 || captured.pages.some((p, i) => !p || p.physical_page !== start + i || typeof p.text !== 'string' || Buffer.byteLength(p.text) > 1024 * 1024) || (total !== null && captured.total_pages !== total) || captured.pypdf_version !== '6.18.0') {
      throw Error('PDF_WINDOW_RESUME_IDENTITY');
    }
    total = captured.total_pages;
    results.push({ file: path.basename(file), sha256: hash(body), start_page: start, count });
    start += count;
    const retained = new Map(known);
    for (const result of results) retained.set(result.file, result);
    const windows = [...retained.values()].sort((a, b) => a.start_page - b.start_page);
    const receipt = { pdf_sha256, extractor_sha256, total_pages: total, next_page: start, completed: start > total, windows, scientific_approval: false };
    const next = path.join(out, 'resume.' + process.pid + '.next.json');
    let created = false;
    try {
      await fs.writeFile(next, JSON.stringify(receipt, null, 2) + String.fromCharCode(10), { flag: 'wx' });
      created = true;
      await fs.rename(next, path.join(out, 'resume.json'));
      created = false;
    } finally {
      if (created) await fs.unlink(next);
    }
    if (results.length % 10 === 0) console.log(JSON.stringify({ captured_pages: start - 1, total_pages: total }));
  }
  console.log(JSON.stringify({ pdf_sha256, pages: total, windows: results.length, completed: true }));
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const [pdf, out] = process.argv.slice(2);
  await collectPdfWindows(pdf, out);
}
