import crypto from 'node:crypto';

export class AppError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function sendJson(res, status, data, headers = {}) {
  const payload = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(payload);
}

export function sendText(res, status, content, contentType = 'text/plain; charset=utf-8', headers = {}) {
  res.writeHead(status, {
    'Content-Type': contentType,
    ...headers
  });
  res.end(content);
}

export function parseCookies(req) {
  const header = req.headers.cookie;
  const result = {};
  if (!header) return result;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(val);
      } catch {
        result[key] = val;
      }
    }
  }
  return result;
}

export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || '127.0.0.1';
}

export function readBodyBuffer(req, maxBytes = 6 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new AppError(413, 'PAYLOAD_TOO_LARGE', 'Ukuran data melebihi batas maksimum.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (err) => reject(err));
  });
}

export async function readJsonBody(req, maxBytes = 1024 * 1024) {
  const buf = await readBodyBuffer(req, maxBytes);
  if (buf.length === 0) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new AppError(400, 'INVALID_JSON', 'Format payload JSON tidak valid.');
  }
}

export function parseMultipart(bodyBuf, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!match) {
    throw new AppError(400, 'INVALID_MULTIPART', 'Boundary multipart tidak ditemukan.');
  }
  const boundary = match[1] || match[2];
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const fields = {};
  const files = [];

  let pos = bodyBuf.indexOf(boundaryBuf);
  if (pos === -1) return { fields, files };

  while (pos !== -1) {
    const start = pos + boundaryBuf.length;
    if (bodyBuf.subarray(start, start + 2).toString() === '--') break; // end boundary
    const nextPos = bodyBuf.indexOf(boundaryBuf, start);
    if (nextPos === -1) break;

    let part = bodyBuf.subarray(start, nextPos);
    if (part.subarray(0, 2).toString() === '\r\n') part = part.subarray(2);
    if (part.subarray(part.length - 2).toString() === '\r\n') part = part.subarray(0, part.length - 2);

    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd !== -1) {
      const headerStr = part.subarray(0, headerEnd).toString('utf8');
      const content = part.subarray(headerEnd + 4);
      const dispMatch = /name="([^"]+)"/i.exec(headerStr);
      const fileMatch = /filename="([^"]*)"/i.exec(headerStr);
      const typeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headerStr);

      if (dispMatch) {
        const fieldName = dispMatch[1];
        if (fileMatch) {
          files.push({
            fieldName,
            originalName: fileMatch[1],
            mimeType: typeMatch ? typeMatch[1].trim().toLowerCase() : 'application/octet-stream',
            buffer: content
          });
        } else {
          fields[fieldName] = content.toString('utf8');
        }
      }
    }
    pos = nextPos;
  }

  return { fields, files };
}

export function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 180) || `item-${crypto.randomBytes(3).toString('hex')}`;
}

export function validateEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized || normalized.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null;
  return normalized;
}

export function cleanText(str, maxLen = 5000) {
  return String(str ?? '').trim().slice(0, maxLen);
}
