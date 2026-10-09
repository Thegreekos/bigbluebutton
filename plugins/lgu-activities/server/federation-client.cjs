const fs = require('node:fs');
const { createHmac, createHash, randomBytes } = require('node:crypto');
const { ContractError } = require('./identity-service.cjs');

const PREFIX = '/api/v1/federation/bbb4/';
const SECRET = '/etc/bigbluebutton/lgu-activities/federation_issuer_secret';
function readFederationSecret() {
  let fd;
  try {
    const directory = '/etc/bigbluebutton/lgu-activities';
    const parent = fs.lstatSync(directory);
    if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== process.getuid()
      || (parent.mode & 0o7777) !== 0o700 || fs.realpathSync(directory) !== directory) throw new Error();
    fd = fs.openSync(SECRET, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const s = fs.fstatSync(fd);
    if (!s.isFile() || s.uid !== process.getuid() || (s.mode & 0o7777) !== 0o600 || s.size !== 43) throw new Error();
    const value = fs.readFileSync(fd, 'utf8');
    if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error();
    return value;
  } catch { throw new ContractError('FEDERATION_NOT_CONFIGURED', 503); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
function signatureHeaders({ issuerId, secret, method, path, body, now, nonce }) {
  const digest = createHash('sha256').update(body).digest('hex');
  const payload = ['LGU-FEDERATION-V1', issuerId, String(now), nonce, method.toUpperCase(), path, digest].join('\n');
  return { 'X-LGU-Federation-Issuer': issuerId, 'X-LGU-Federation-Timestamp': String(now),
    'X-LGU-Federation-Nonce': nonce,
    'X-LGU-Federation-Signature': createHmac('sha256', secret).update(payload).digest('hex') };
}
function safeView(value) {
  const privateKeys = new Set(['ticket', 'credentials', 'credential', 'token', 'secret', 'cookie', 'cookies',
    'code', 'joinpath', 'pending', 'signature', 'authorization', 'set-cookie']);
  if (Array.isArray(value)) return value.map(safeView);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !privateKeys.has(key.toLowerCase()) && !privateKeys.has(key)).map(([k, v]) => [k, safeView(v)]));
  return value;
}
function validPrivateResourcePath(path) {
  if (typeof path !== 'string' || path.length > 4096 || /[\r\n#\\]/.test(path) || path.includes('..')) return false;
  if (/^\/media\/[a-z0-9_-]{1,128}\/[a-z0-9._-]{1,255}$/i.test(path)) return true;
  if (!path.startsWith('/api/audio?')) return false;
  const url = new URL(path, 'https://lgu.invalid');
  if (url.pathname !== '/api/audio') return false;
  const allowed = new Set(['mode', 'id', 'qid', 'version', 'lang', 'segment']);
  for (const key of url.searchParams.keys()) if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) return false;
  const mode = url.searchParams.get('mode');
  const id = url.searchParams.get('id');
  const lang = url.searchParams.get('lang');
  const segment = url.searchParams.get('segment');
  return ['live', 'round', 'learning'].includes(mode)
    && /^[\da-f-]{36}$/i.test(id || '') && ['el', 'en'].includes(lang)
    && /^[a-z0-9:_-]{1,100}$/i.test(segment || '')
    && (!url.searchParams.has('qid') || /^[\da-f-]{36}$/i.test(url.searchParams.get('qid')))
    && (!url.searchParams.has('version') || /^\d{1,10}$/.test(url.searchParams.get('version')));
}
class CookieVault {
  constructor(clock) { this.clock = clock; this.cookies = new Map(); }
  absorb(headers) {
    const lines = headers.getSetCookie?.() ?? (headers.get('set-cookie')?.split(/,(?=\s*lgu_)/) || []);
    for (const line of lines) {
      const fields = line.split(';').map(f => f.trim());
      const match = /^(lgu_fed|lgu_session|lgu_live)=([A-Za-z0-9_-]{0,128})$/.exec(fields[0]);
      if (!match) continue;
      const max = fields.find(f => /^max-age=/i.test(f));
      const ttl = max ? Number(max.split('=')[1]) : 0;
      if (!Number.isSafeInteger(ttl) || ttl <= 0 || !/^[\w-]{43}$/.test(match[2])) this.cookies.delete(match[1]);
      else this.cookies.set(match[1], { value: match[2], expiresAt: this.clock() + Math.min(ttl, 43200) });
    }
  }
  header() {
    const result = [];
    for (const [name, entry] of this.cookies) {
      if (entry.expiresAt <= this.clock()) this.cookies.delete(name);
      else result.push(`${name}=${entry.value}`);
    }
    return result.join('; ');
  }
  has(name) { this.header(); return this.cookies.has(name); }
  clear() { this.cookies.clear(); }
}
function createFederationClient({ origin, issuerId, readSecret = readFederationSecret, fetchImpl = fetch,
  clock = () => Math.floor(Date.now() / 1000), allowLoopback = false }) {
  const url = new URL(origin);
  if (url.origin !== origin || url.username || url.password || (url.protocol !== 'https:'
    && !(allowLoopback && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))
    || !/^[a-z0-9][a-z0-9_-]{1,63}$/.test(issuerId)) throw new TypeError('Invalid federation server config');
  async function request(method, path, data, { signed = false, vault, stream = false, signal } = {}) {
    if (!path.startsWith(PREFIX) && !/^\/api\/v1\/live\/[\da-f-]{36}(?:\/(?:answer|stream))?(?:\?after=\d+)?$/i.test(path)) {
      throw new ContractError('FEDERATION_PATH_DENIED', 400);
    }
    if (/[\r\n#\\]/.test(path) || path.includes('..') || new URL(path, origin).origin !== origin) throw new ContractError('FEDERATION_PATH_DENIED', 400);
    const body = method === 'GET' ? '' : JSON.stringify(data ?? {});
    const headers = { Accept: stream ? 'text/event-stream' : 'application/json', 'Content-Type': 'application/json' };
    if (signed) Object.assign(headers, signatureHeaders({ issuerId, secret: readSecret(), method, path, body,
      now: clock(), nonce: randomBytes(24).toString('base64url') }));
    else {
      headers.Origin = origin; headers['X-LGU-Request'] = '1';
      const cookie = vault?.header(); if (cookie) headers.Cookie = cookie;
    }
    let response;
    // A player stream is long-lived. The browser disconnect signal owns its lifetime;
    // the generous cap is only a final bound for orphaned server-side connections.
    const timeout = AbortSignal.timeout(stream ? 12 * 60 * 60 * 1000 : 8000);
    try { response = await fetchImpl(origin + path, { method, headers, body: method === 'GET' ? undefined : body,
      redirect: 'error', credentials: 'omit', cache: 'no-store', signal: signal ? AbortSignal.any([signal, timeout]) : timeout }); }
    catch { throw new ContractError('LGU_UNAVAILABLE', 503); }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const status = [401, 403, 404, 409, 429].includes(response.status) ? response.status : 503;
      throw new ContractError(`LGU_${status}`, status);
    }
    if (!signed) vault?.absorb(response.headers);
    if (stream) {
      if (!response.headers.get('content-type')?.startsWith('text/event-stream') || !response.body) throw new ContractError('LGU_INVALID_RESPONSE', 502);
      return response;
    }
    try {
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error();
      const reader = response.body.getReader(); const chunks = []; let size = 0;
      try { while (true) { const { value, done } = await reader.read(); if (done) break;
        size += value.length; if (size > 1048576) throw new Error(); chunks.push(value); } }
      finally { reader.releaseLock(); }
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
      return result;
    } catch { await response.body?.cancel().catch(() => {}); throw new ContractError('LGU_INVALID_RESPONSE', 502); }
  }
  async function resource(path, { vault, signal, accept = '*/*', client = 'web/0.1.0' } = {}) {
    if (!validPrivateResourcePath(path) || !vault?.header()) throw new ContractError('FEDERATION_PATH_DENIED', 400);
    const timeout = AbortSignal.timeout(60000);
    let response;
    try {
      response = await fetchImpl(origin + path, { method: 'GET', headers: { Accept: accept,
        'X-LGU-Client': /^[\w./-]{1,80}$/.test(client) ? client : 'web/0.1.0',
        Origin: origin, Cookie: vault.header() }, redirect: 'error', credentials: 'omit', cache: 'no-store',
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    } catch { throw new ContractError('LGU_UNAVAILABLE', 503); }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const status = [401, 403, 404, 409, 429, 416].includes(response.status) ? response.status : 503;
      throw new ContractError(`LGU_${status}`, status);
    }
    vault.absorb(response.headers);
    const type = response.headers.get('content-type') || '';
    if (!/^(?:image|audio)\/[a-z0-9.+-]+(?:\s*;|$)/i.test(type) || !response.body) {
      await response.body?.cancel().catch(() => {});
      throw new ContractError('LGU_INVALID_RESPONSE', 502);
    }
    return response;
  }
  return { request, resource, vault: () => new CookieVault(clock), clock };
}
module.exports = { PREFIX, SECRET, signatureHeaders, safeView, validPrivateResourcePath, CookieVault, createFederationClient, readFederationSecret };