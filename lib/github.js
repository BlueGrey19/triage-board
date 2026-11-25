/**
 * Minimal GitHub client: GitHub App user login (web flow), token refresh,
 * and the handful of REST / GraphQL calls the GitHub storage backend needs.
 *
 * Uses Node's built-in fetch (Node 18+), so there are no extra dependencies.
 */

const API = 'https://api.github.com';

class GitHubError extends Error {
  constructor(status, message, network) {
    super(message || ('GitHub request failed (' + status + ')'));
    this.status = status;
    // true when GitHub couldn't be reached at all (as opposed to GitHub saying no)
    this.network = !!network;
  }
}

// Pauses between attempts when the connection itself fails. Node reuses
// connections, and GitHub sometimes closes an idle one just as we send on it
// ("other side closed"); the next attempt opens a fresh connection.
const RETRY_DELAYS = [300, 1000];
// GitHub's own "try again" responses.
const RETRY_STATUSES = [502, 503, 504];
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Retrying a write is safe here: board writes carry the file's SHA, so a
// write that already went through comes back as a conflict, and the caller
// re-reads and re-applies (see store-github.js).
async function fetchWithRetry(url, options) {
  for (let attempt = 0; ; attempt++) {
    let r;
    try {
      r = await fetch(url, options);
    } catch (e) {
      if (attempt >= RETRY_DELAYS.length) {
        const why = (e.cause && (e.cause.code || e.cause.message)) || e.message;
        console.warn('GitHub unreachable after ' + (attempt + 1) + ' tries (' + why + ')');
        throw new GitHubError(503, 'Couldn\'t reach GitHub. Check your connection and try again.', true);
      }
      await sleep(RETRY_DELAYS[attempt]);
      continue;
    }
    if (RETRY_STATUSES.includes(r.status) && attempt < RETRY_DELAYS.length) {
      await sleep(RETRY_DELAYS[attempt]);
      continue;
    }
    return r;
  }
}

async function request(token, method, url, body) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'triage-board'
  };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetchWithRetry(url.startsWith('http') ? url : API + url, {
    method, headers, body: body ? JSON.stringify(body) : undefined
  });
  const data = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) throw new GitHubError(r.status, data && data.message);
  return data;
}

async function graphql(token, query, variables) {
  const data = await request(token, 'POST', '/graphql', { query, variables });
  if (data && data.errors && data.errors.length) throw new GitHubError(502, data.errors[0].message);
  return data.data;
}

/* ---------- GitHub App user authorization (web application flow) ---------- */

function authorizeUrl({ clientId, redirectUri, state }) {
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state });
  return 'https://github.com/login/oauth/authorize?' + q.toString();
}

async function tokenRequest(params) {
  const r = await fetchWithRetry('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'triage-board' },
    body: JSON.stringify(params)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error || !data.access_token) {
    throw new GitHubError(401, data.error_description || data.error || 'Token request failed');
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || '',
    // expires_in is only present when "Expire user authorization tokens" is on (the default).
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : 0
  };
}

function exchangeCode({ clientId, clientSecret, code, redirectUri }) {
  return tokenRequest({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri });
}

function refreshToken({ clientId, clientSecret, refreshToken }) {
  return tokenRequest({
    client_id: clientId, client_secret: clientSecret,
    grant_type: 'refresh_token', refresh_token: refreshToken
  });
}

module.exports = { GitHubError, request, graphql, authorizeUrl, exchangeCode, refreshToken };
