import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET ?? 'shiphero-secret-key-2024';

export interface AuthenticatedRequest extends Request {
  userEmail?: string;
  userName?:  string;
  userTitle?: string;
}

export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Not authenticated' });
    return;
  }

  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as {
      email: string;
      name:  string;
      title?: string;
    };
    req.userEmail = payload.email;
    req.userName  = payload.name;
    req.userTitle = payload.title ?? '';
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
}
