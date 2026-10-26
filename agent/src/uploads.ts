// Attachments: the user uploads images or documents in the chat. Types are
// checked by content (magic bytes), not by the name the browser sends. Text is
// extracted locally (PDF, DOCX, plain text) so every model can read documents;
// images go only to models that can see them. Stored 0600 under <home>/uploads.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AgentError } from './types.ts';
import type { AttachmentBlock } from './types.ts';
import { audit } from './obs/audit.ts';

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

type Meta = { id: string; name: string; mime: string; kind: 'image' | 'document'; size: number; chars?: number; pages?: number; createdAt: number; extractionVersion?: number; extractionStatus?: 'complete' | 'failed'; extractionWarning?: string };

function sniff(buf: Buffer, name: string): { mime: string; kind: 'image' | 'document' } {
  const hex = buf.subarray(0, 12).toString('hex');
  if (hex.startsWith('89504e47')) return { mime: 'image/png', kind: 'image' };
  if (hex.startsWith('ffd8ff')) return { mime: 'image/jpeg', kind: 'image' };
  if (hex.startsWith('47494638')) return { mime: 'image/gif', kind: 'image' };
  if (hex.startsWith('52494646') && buf.subarray(8, 12).toString() === 'WEBP') return { mime: 'image/webp', kind: 'image' };
  if (buf.subarray(0, 5).toString() === '%PDF-') return { mime: 'application/pdf', kind: 'document' };
  if (hex.startsWith('504b0304') && /\.docx$/i.test(name)) return { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'document' };
  if (/\.(txt|md|csv|json|tsv|log)$/i.test(name)) {
    const text = buf.toString('utf8');
    if (!text.includes('\u0000') && !text.includes('�')) return { mime: /\.csv$/i.test(name) ? 'text/csv' : /\.json$/i.test(name) ? 'application/json' : 'text/plain', kind: 'document' };
  }
  throw new AgentError('UNSUPPORTED_FILE', 'Supported: PNG, JPEG, GIF, WebP images; PDF, DOCX, TXT, MD, CSV, JSON documents.', 415);
}

const safeName = (n: string) => (n.replace(/[^\w.\- ()]/g, '_').replace(/^\.+/, '').slice(0, 120) || 'file');

async function extractText(buf: Buffer, mime: string): Promise<{ text: string; pages?: number }> {
  if (mime === 'application/pdf') {
    const { extractText: pdfText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const r = await pdfText(pdf, { mergePages: true });
    return { text: String(r.text), pages: r.totalPages };
  }
  if (mime.includes('wordprocessingml')) {
    const mammoth = await import('mammoth');
    const r = await (mammoth as any).default.extractRawText({ buffer: buf });
    return { text: String(r.value) };
  }
  return { text: buf.toString('utf8') };
}

export async function saveUpload(home: string, name: string, dataBase64: string): Promise<Meta> {
  if (typeof dataBase64 !== 'string' || dataBase64.length > MAX_UPLOAD_BYTES * 1.4) throw new AgentError('TOO_LARGE', 'File too large (max 15 MB)', 413);
  const buf = Buffer.from(dataBase64, 'base64');
  if (!buf.length) throw new AgentError('BAD_INPUT', 'Empty file');
  if (buf.length > MAX_UPLOAD_BYTES) throw new AgentError('TOO_LARGE', 'File too large (max 15 MB)', 413);
  const { mime, kind } = sniff(buf, name);
  const id = 'up_' + crypto.randomBytes(9).toString('base64url');
  const dir = path.join(home, 'uploads', id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, safeName(name));
  fs.writeFileSync(file, buf, { mode: 0o600 });
  const meta: Meta = { id, name: safeName(name), mime, kind, size: buf.length, createdAt: Date.now() };
  if (kind === 'document') {
    meta.extractionVersion = 2; meta.extractionStatus = 'failed';
    try {
      const { text, pages } = await extractText(buf, mime);
      const clean = text.replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
      fs.writeFileSync(path.join(dir, 'extracted.txt'), clean, { mode: 0o600 });
      meta.chars = clean.length; meta.pages = pages; meta.extractionVersion = 2;
      if (!clean) throw new Error('no text layer (scanned document?)');
      meta.extractionStatus = 'complete';
    } catch (e) {
      audit('upload.extract_failed', { id, mime, error: String((e as Error).message) });
      meta.chars = 0;
      meta.extractionWarning = 'Document text extraction failed. Re-upload the document to retry (scanned files may need OCR).';
    }
  }
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta), { mode: 0o600 });
  audit('upload', { id, name: meta.name, mime, kind, size: buf.length, chars: meta.chars, pages: meta.pages });
  return meta;
}

export function getUpload(home: string, id: string): (Meta & { file: string; dir: string }) | null {
  if (!/^up_[\w-]{8,}$/.test(id)) return null;
  const dir = path.join(home, 'uploads', id);
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) as Meta;
    return { ...meta, dir, file: path.join(dir, meta.name) };
  } catch { return null; }
}

export function attachmentBlock(m: Meta): AttachmentBlock {
  return { type: 'attachment', id: m.id, name: m.name, mime: m.mime, kind: m.kind, chars: m.chars };
}

export function documentText(home: string, id: string, maxChars = Infinity): string | null {
  const u = getUpload(home, id); if (!u) return null;
  try { const t = fs.readFileSync(path.join(u.dir, 'extracted.txt'), 'utf8'); return t.length > maxChars ? t.slice(0, maxChars) + `\n…[document truncated: ${t.length} chars total]` : t; }
  catch { return null; }
}

export function imageBase64(home: string, id: string): { mime: string; data: string; name: string } | null {
  const u = getUpload(home, id); if (!u || u.kind !== 'image') return null;
  return { mime: u.mime, data: fs.readFileSync(u.file).toString('base64'), name: u.name };
}

/** Repair older capped extracts from the preserved original upload, locally. */
export async function ensureDocumentText(home: string, id: string): Promise<{ text: string | null; complete: boolean; warning?: string }> {
  const u = getUpload(home, id);
  if (!u || u.kind !== 'document') return { text: null, complete: false };
  if (u.extractionVersion === 2) {
    const text = documentText(home, id);
    const complete = u.extractionStatus !== 'failed' && !!text;
    return { text, complete, warning: complete ? undefined : (u.extractionWarning || 'No document text is available. Re-upload the document to retry.') };
  }
  try {
    const { text, pages } = await extractText(fs.readFileSync(u.file), u.mime);
    const clean = text.replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
    const { file: _file, dir: _dir, ...meta } = u;
    fs.writeFileSync(path.join(u.dir, 'extracted.txt'), clean, { mode: 0o600 });
    fs.writeFileSync(path.join(u.dir, 'meta.json'), JSON.stringify({ ...meta, chars: clean.length, pages, extractionVersion: 2, extractionStatus: clean ? 'complete' : 'failed', extractionWarning: clean ? undefined : 'No document text is available. Re-upload the document to retry.' }), { mode: 0o600 });
    return { text: clean, complete: !!clean, warning: clean ? undefined : 'No document text is available. Re-upload the document to retry.' };
  } catch {
    const warning = 'Legacy extraction may be incomplete; the original could not be re-extracted. Re-upload the document.';
    const { file: _file, dir: _dir, ...meta } = u;
    fs.writeFileSync(path.join(u.dir, 'meta.json'), JSON.stringify({ ...meta, extractionVersion: 2, extractionStatus: 'failed', extractionWarning: warning }), { mode: 0o600 });
    return { text: documentText(home, id), complete: false, warning };
  }
}
