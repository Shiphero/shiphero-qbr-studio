/**
 * File-based user store. Keyed by lowercase email.
 * Stored in .users.json at the project root (gitignored).
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const USERS_FILE = join(__dirname, '../../.users.json');

export interface User {
  email: string;
  passwordHash: string;
  name: string;
  title: string;
  photo: string | null;   // base64 data URL
  createdAt: string;
}

type UserStore = Record<string, User>;

function read(): UserStore {
  try {
    if (!existsSync(USERS_FILE)) return {};
    return JSON.parse(readFileSync(USERS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function write(store: UserStore) {
  writeFileSync(USERS_FILE, JSON.stringify(store, null, 2), 'utf8');
}

export function getUser(email: string): User | null {
  return read()[email.toLowerCase()] ?? null;
}

export async function createUser(
  email: string,
  password: string,
  name: string,
  title: string,
): Promise<User> {
  const store = read();
  const key = email.toLowerCase();
  if (store[key]) throw new Error('Email already registered');
  const passwordHash = await bcrypt.hash(password, 10);
  const user: User = {
    email: key,
    passwordHash,
    name: name.trim(),
    title: title.trim(),
    photo: null,
    createdAt: new Date().toISOString(),
  };
  store[key] = user;
  write(store);
  return user;
}

export async function verifyPassword(email: string, password: string): Promise<User | null> {
  const user = getUser(email);
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  return ok ? user : null;
}

export function updateUser(
  email: string,
  updates: Partial<Pick<User, 'name' | 'title' | 'photo'>>,
): User | null {
  const store = read();
  const key = email.toLowerCase();
  if (!store[key]) return null;
  store[key] = { ...store[key], ...updates };
  write(store);
  return store[key];
}
