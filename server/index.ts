import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import authRouter from './routes/auth.js';
import hubspotRouter from './routes/hubspot.js';
import aiRouter from './routes/ai.js';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

// Allowed origins — localhost in dev, APP_URL in production (can be comma-separated for multiple domains)
const allowedOrigins: string[] = [
  'http://localhost:5173',
  'http://localhost:4173',
];

if (process.env.APP_URL) {
  // Support comma-separated list: APP_URL=https://foo.railway.app,https://qbr.shiphero.com
  process.env.APP_URL.split(',').map(u => u.trim()).filter(Boolean).forEach(u => {
    allowedOrigins.push(u.replace(/\/$/, '')); // strip trailing slash
  });
}

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, curl, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin not allowed — ${origin}`));
  },
  credentials: true,
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', authRouter);
app.use('/api/hubspot', hubspotRouter);
app.use('/api/ai', aiRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  const distPath = join(__dirname, '../dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    res.sendFile(join(distPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`ShipHero Warehouse Optimizer server running on port ${PORT}`);
});

export default app;
