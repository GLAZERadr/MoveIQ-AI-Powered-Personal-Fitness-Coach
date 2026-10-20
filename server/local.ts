/** Local runner (`npm run server:start`). On Vercel, app.ts is the entry and this file is not used. */
import { serve } from '@hono/node-server';
import app from './app.js';
import { closeDb } from './db.js';
import { env } from './env.js';
import { migrate, migrateAuth } from './migrate.js';

await migrate();
await migrateAuth();
const server = serve({ fetch: app.fetch, port: env.port, hostname: '0.0.0.0' }, (info) => {
  console.log(`MoveIQ cloud service listening on http://localhost:${info.port}`);
});

const shutdown = () => {
  server.close();
  void closeDb().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
