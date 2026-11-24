/**
 * Sessions as an encrypted, HttpOnly cookie (AES-256-GCM).
 *
 * The GitHub tokens live only inside this cookie, encrypted with
 * SESSION_SECRET. The browser can't read them (HttpOnly) and can't forge or
 * tamper with them (authenticated encryption). Nothing is kept in server
 * memory, so sessions survive restarts and redeploys on free hosting.
 */

const crypto = require('crypto');

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function serializeCookie(name, value, { maxAge, secure, path = '/' } = {}) {
  let c = name + '=' + encodeURIComponent(value) + '; Path=' + path + '; HttpOnly; SameSite=Lax';
  if (maxAge != null) c += '; Max-Age=' + Math.floor(maxAge);
  if (secure) c += '; Secure';
  return c;
}

function createSealer(secret) {
  const key = crypto.createHash('sha256').update(String(secret)).digest();
  return {
    seal(obj) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const enc = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64url');
    },
    unseal(str) {
      try {
        const buf = Buffer.from(String(str || ''), 'base64url');
        if (buf.length < 29) return null;
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
        decipher.setAuthTag(buf.subarray(12, 28));
        return JSON.parse(Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8'));
      } catch (_) {
        return null;
      }
    }
  };
}

module.exports = { parseCookies, serializeCookie, createSealer };
