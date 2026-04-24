/**
 * Simple file-based token store for HubSpot OAuth tokens.
 * Keyed by user email. In production, swap this for a database.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = join(__dirname, '../../.hubspot-tokens.json');

export interface HubSpotTokens {
  accessToken:  string;
  refreshToken: string;
  expiresAt:    number; // Unix ms
  hubId:        number;
  hubDomain:    string;
}

type TokenStore = Record<string, HubSpotTokens>;

function read(): TokenStore {
  try {
    if (!existsSync(TOKEN_FILE)) return {};
    return JSON.parse(readFileSync(TOKEN_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function write(store: TokenStore) {
  writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2), 'utf8');
}

export function getTokens(email: string): HubSpotTokens | null {
  return read()[email] ?? null;
}

export function setTokens(email: string, tokens: HubSpotTokens) {
  const store = read();
  store[email] = tokens;
  write(store);
}

export function deleteTokens(email: string) {
  const store = read();
  delete store[email];
  write(store);
}

export function isConnected(email: string): boolean {
  return !!read()[email];
}
