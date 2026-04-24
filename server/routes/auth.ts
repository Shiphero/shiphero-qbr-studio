import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { createUser, verifyPassword, getUser, updateUser } from '../store/userStore.js';
import { requireAuth, AuthenticatedRequest } from '../middleware/requireAuth.js';

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET ?? 'shiphero-secret-key-2024';
const ALLOWED_DOMAIN = '@shiphero.com';

function makeToken(email: string, name: string, title: string) {
  return jwt.sign({ email, name, title }, JWT_SECRET, { expiresIn: '30d' });
}

function publicUser(user: { email: string; name: string; title: string; photo: string | null }) {
  return { email: user.email, name: user.name, title: user.title, photo: user.photo };
}

// ─── Register ────────────────────────────────────────────────────────────────
router.post('/register', async (req: Request, res: Response) => {
  const { email, password, name, title } = req.body as Record<string, string>;

  if (!email || !password || !name) {
    res.status(400).json({ message: 'Email, password, and name are required' });
    return;
  }

  const normalised = email.trim().toLowerCase();

  if (!normalised.endsWith(ALLOWED_DOMAIN)) {
    res.status(403).json({ message: 'Only @shiphero.com email addresses may register' });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ message: 'Password must be at least 8 characters' });
    return;
  }

  try {
    const user = await createUser(normalised, password, name, title ?? '');
    const token = makeToken(user.email, user.name, user.title);
    res.status(201).json({ token, user: publicUser(user) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Registration failed';
    res.status(409).json({ message });
  }
});

// ─── Login ────────────────────────────────────────────────────────────────────
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body as Record<string, string>;

  if (!email || !password) {
    res.status(400).json({ message: 'Email and password are required' });
    return;
  }

  const user = await verifyPassword(email.trim().toLowerCase(), password);

  if (!user) {
    res.status(401).json({ message: 'Invalid email or password' });
    return;
  }

  const token = makeToken(user.email, user.name, user.title);
  res.json({ token, user: publicUser(user) });
});

// ─── Verify ───────────────────────────────────────────────────────────────────
router.get('/verify', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ message: 'No token provided' });
    return;
  }

  try {
    const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET) as {
      email: string;
      name: string;
      title: string;
    };

    // Return the freshest profile from the store so any edits are reflected
    const stored = getUser(decoded.email);
    const user = stored
      ? publicUser(stored)
      : { email: decoded.email, name: decoded.name, title: decoded.title ?? '', photo: null };

    res.json({ valid: true, user });
  } catch {
    res.status(401).json({ valid: false, message: 'Invalid or expired token' });
  }
});

// ─── Update profile ───────────────────────────────────────────────────────────
router.put('/profile', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const { name, title, photo } = req.body as Record<string, string | null | undefined>;

  const updated = updateUser(req.userEmail!, {
    ...(name  !== undefined ? { name:  (name  ?? '').trim() } : {}),
    ...(title !== undefined ? { title: (title ?? '').trim() } : {}),
    ...(photo !== undefined ? { photo: photo ?? null } : {}),
  });

  if (!updated) {
    res.status(404).json({ message: 'User not found' });
    return;
  }

  res.json({ user: publicUser(updated) });
});

export default router;
