import { useState, useEffect, useCallback } from 'react';

export interface HubSpotStatus {
  connected: boolean;
  hubId:     number | null;
  hubDomain: string | null;
}

function getToken() {
  return localStorage.getItem('auth_token') ?? '';
}

function authHeaders() {
  return { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' };
}

export interface HubSpotRecord {
  id: string;
  properties: Record<string, string | null>;
  createdAt?: string;
  updatedAt?: string;
}

export function useHubSpot() {
  const [status,  setStatus]  = useState<HubSpotStatus>({ connected: false, hubId: null, hubDomain: null });
  const [loading, setLoading] = useState(true);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/hubspot/status', { headers: authHeaders() });
      if (res.ok) setStatus(await res.json());
    } catch { /* server not running */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    checkStatus();
    // If the user just returned from OAuth, check status and clean the URL
    if (window.location.search.includes('hs_connected')) {
      window.history.replaceState({}, '', window.location.pathname);
      checkStatus();
    }
  }, [checkStatus]);

  // Open HubSpot OAuth in the same tab (server gives us the URL)
  const connect = useCallback(async () => {
    const res = await fetch('/api/hubspot/connect', { headers: authHeaders() });
    if (!res.ok) { alert('Failed to initiate HubSpot OAuth. Check server config.'); return; }
    const { url } = await res.json() as { url: string };
    window.location.href = url;
  }, []);

  const disconnect = useCallback(async () => {
    await fetch('/api/hubspot/disconnect', { method: 'DELETE', headers: authHeaders() });
    setStatus({ connected: false, hubId: null, hubDomain: null });
  }, []);

  // Generic proxy call
  const call = useCallback(async <T = unknown>(
    path: string,
    method = 'GET',
    data?: unknown,
    params?: Record<string, string>,
  ): Promise<T> => {
    const res = await fetch('/api/hubspot/proxy', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ path, method, data, params }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json() as T;
  }, []);

  return { status, loading, connect, disconnect, call };
}
