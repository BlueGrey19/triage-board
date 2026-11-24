/**
 * Minimal GitHub client: GitHub App user login (web flow), token refresh,
 * and the handful of REST / GraphQL calls the GitHub storage backend needs.
 *
 * Uses Node's built-in fetch (Node 18+), so there are no extra dependencies.
 */

const API = 'https://api.github.com';

class GitHubError extends Error {
  constructor(status, message) {
    super(message || ('GitHub request failed (' + status + ')'));
    this.status = status;
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
  const r = await fetch(url.startsWith('http') ? url : API + url, {
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
  const r = await fetch('https://github.com/login/oauth/access_token', {
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
