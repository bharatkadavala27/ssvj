import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import { env } from './config/env.js';
import publicRoutes from './routes/public.js';
import adminRoutes from './routes/admin.js';
import authRoutes from './routes/auth.js';
import sevakRoutes from './routes/sevak.js';
import { errorHandler, notFound } from './middleware/errors.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    cors({
      // No Origin header = native/curl request; otherwise it must be on the allow-list.
      origin: (origin, cb) => cb(null, !origin || env.corsOrigins.includes(origin)),
      allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    }),
  );
  // Compression would buffer the SSE stream, so skip it there.
  app.use(compression({ filter: (req, res) => req.path !== '/api/live' && compression.filter(req, res) }));
  // A wedding year's donor list can run to hundreds of rows, so the dashboard API takes larger bodies.
  app.use('/api/admin', express.json({ limit: '1mb' }));
  app.use(express.json({ limit: '100kb' }));
  // Successful uptime pings (every 5 minutes) would only add noise to the log.
  app.use(morgan(env.isProd ? 'combined' : 'dev', { skip: (req, res) => req.originalUrl.startsWith('/api/health') && res.statusCode < 400 }));

  app.get('/', (req, res) => res.json({ name: 'ssvj-backend', api: '/api' }));
  app.use('/api', publicRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/sevak', sevakRoutes);
  app.use('/api/admin', adminRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
