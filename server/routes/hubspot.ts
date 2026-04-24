import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/requireAuth.js';
import {
  getTokens, setTokens, deleteTokens, isConnected, HubSpotTokens,
} from '../store/hubspotTokens.js';

const router = Router();

const CLIENT_ID     = process.env.HUBSPOT_CLIENT_ID     ?? '';
const CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET ?? '';
const REDIRECT_URI  = process.env.HUBSPOT_REDIRECT_URI  ?? 'http://localhost:3001/api/hubspot/callback';
const APP_URL       = process.env.APP_URL               ?? 'http://localhost:5173';

const SCOPES = [
  'crm.objects.contacts.read',
  'crm.objects.contacts.write',
  'crm.objects.deals.read',
  'crm.objects.deals.write',
  'crm.objects.notes.read',
  'crm.objects.notes.write',
  'crm.objects.tasks.read',
  'crm.objects.tasks.write',
  'crm.objects.companies.read',
  'crm.objects.companies.write',
].join(' ');

// Pending OAuth sessions: state → userEmail
const pendingSessions = new Map<string, string>();

// ── Refresh access token ──────────────────────────────────────────────────────
async function refreshAccessToken(email: string): Promise<HubSpotTokens | null> {
  const tokens = getTokens(email);
  if (!tokens) return null;

  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri:  REDIRECT_URI,
    refresh_token: tokens.refreshToken,
  });

  const res = await fetch('https://api.hubspot.com/oauth/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) return null;

  const data = await res.json() as {
    access_token: string; refresh_token: string; expires_in: number;
  };

  const refreshed: HubSpotTokens = {
    ...tokens,
    accessToken:  data.access_token,
    refreshToken: data.refresh_token ?? tokens.refreshToken,
    expiresAt:    Date.now() + (data.expires_in - 60) * 1000,
  };

  setTokens(email, refreshed);
  return refreshed;
}

// ── Get valid access token (auto-refresh) ─────────────────────────────────────
async function getValidToken(email: string): Promise<string | null> {
  let tokens = getTokens(email);
  if (!tokens) return null;
  if (Date.now() >= tokens.expiresAt) {
    tokens = await refreshAccessToken(email);
  }
  return tokens?.accessToken ?? null;
}

// ── GET /api/hubspot/status ───────────────────────────────────────────────────
router.get('/status', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const email   = req.userEmail!;
  const tokens  = getTokens(email);
  const connected = !!tokens;
  res.json({
    connected,
    hubId:     tokens?.hubId     ?? null,
    hubDomain: tokens?.hubDomain ?? null,
  });
});

// ── GET /api/hubspot/connect ──────────────────────────────────────────────────
router.get('/connect', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  if (!CLIENT_ID) {
    res.status(500).json({ message: 'HUBSPOT_CLIENT_ID not configured' });
    return;
  }

  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  pendingSessions.set(state, req.userEmail!);
  // Clean up after 10 minutes
  setTimeout(() => pendingSessions.delete(state), 10 * 60 * 1000);

  const url = new URL('https://app.hubspot.com/oauth/authorize');
  url.searchParams.set('client_id',    CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope',        SCOPES);
  url.searchParams.set('state',        state);

  res.json({ url: url.toString() });
});

// ── GET /api/hubspot/callback ─────────────────────────────────────────────────
router.get('/callback', async (req, res: Response) => {
  const { code, state, error } = req.query as Record<string, string>;

  if (error) {
    res.redirect(`${APP_URL}?hs_error=${encodeURIComponent(error)}`);
    return;
  }

  const email = pendingSessions.get(state);
  if (!email) {
    res.redirect(`${APP_URL}?hs_error=invalid_state`);
    return;
  }
  pendingSessions.delete(state);

  // Exchange code for tokens
  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri:  REDIRECT_URI,
    code,
  });

  const tokenRes = await fetch('https://api.hubspot.com/oauth/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    res.redirect(`${APP_URL}?hs_error=${encodeURIComponent(err)}`);
    return;
  }

  const tokenData = await tokenRes.json() as {
    access_token: string; refresh_token: string; expires_in: number;
  };

  // Get portal info
  const infoRes = await fetch('https://api.hubapi.com/oauth/v1/access-tokens/' + tokenData.access_token);
  const info    = infoRes.ok ? await infoRes.json() as { hub_id: number; hub_domain: string } : { hub_id: 0, hub_domain: '' };

  setTokens(email, {
    accessToken:  tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt:    Date.now() + (tokenData.expires_in - 60) * 1000,
    hubId:        info.hub_id,
    hubDomain:    info.hub_domain,
  });

  res.redirect(`${APP_URL}?hs_connected=1`);
});

// ── DELETE /api/hubspot/disconnect ────────────────────────────────────────────
router.delete('/disconnect', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  deleteTokens(req.userEmail!);
  res.json({ ok: true });
});

// ── POST /api/hubspot/proxy ───────────────────────────────────────────────────
// Body: { path: string, method?: string, data?: unknown, params?: Record<string,string> }
router.post('/proxy', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const email = req.userEmail!;
  const { path, method = 'GET', data, params } = req.body as {
    path: string;
    method?: string;
    data?: unknown;
    params?: Record<string, string>;
  };

  const accessToken = await getValidToken(email);
  if (!accessToken) {
    res.status(401).json({ message: 'HubSpot not connected' });
    return;
  }

  const url = new URL(`https://api.hubspot.com${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const hsRes = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: data ? JSON.stringify(data) : undefined,
  });

  const responseData = await hsRes.json();
  res.status(hsRes.status).json(responseData);
});

export default router;
