import 'dotenv/config';
import http from 'http';
import { testConnection, initTables, sql } from './db';
import { syncAllPlayers, syncOnePlayer, autoEnrichTopPlayers, TOP_PLAYERS } from './sync/players';
import { syncAllClubs } from './sync/clubs';
import { getTransferStats } from './sync/transfers';
import { sleep } from './tm-client';

let isSyncing = false;

async function fullSync() {
  if (isSyncing) {
    console.log('[Sync] ⚠️ Already syncing');
    return;
  }
  isSyncing = true;
  const start = Date.now();

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`[Sync] 🔄 Full sync started at ${new Date().toISOString()}`);
  console.log(`${'═'.repeat(50)}\n`);

  try {
    const clubResult = await syncAllClubs();
    const playerResult = await syncAllPlayers();
    const autoResult = await autoEnrichTopPlayers(50);
    const transferStats = await getTransferStats();
    const duration = Math.round((Date.now() - start) / 1000);

    const playerCount = await sql`SELECT COUNT(*) as count FROM players`;
    const enrichedCount = await sql`SELECT COUNT(*) as count FROM players WHERE is_enriched = true`;
    const clubCount = await sql`SELECT COUNT(*) as count FROM clubs`;

    console.log(`\n${'═'.repeat(50)}`);
    console.log(`[Sync] ✅ Done in ${duration}s`);
    console.log(`[Sync] 📊 Clubs: ${clubCount[0]?.count || 0}`);
    console.log(`[Sync] 📊 Players: ${playerCount[0]?.count || 0} (${enrichedCount[0]?.count || 0} enriched)`);
    console.log(`[Sync] 📊 Transfers: ${transferStats.total}`);
    console.log(`${'═'.repeat(50)}\n`);
  } finally {
    isSyncing = false;
  }
}

function startHttpServer() {
  const PORT = process.env.PORT || 3000;
  const SECRET = process.env.SYNC_SECRET || 'changeme';

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);
    res.setHeader('Content-Type', 'application/json');

    if (url.pathname === '/health') {
      res.writeHead(200);
      return res.end(JSON.stringify({ ok: true, syncing: isSyncing }));
    }

    if (url.pathname === '/api/status') {
      const p = await sql`SELECT COUNT(*) as c FROM players`;
      const c = await sql`SELECT COUNT(*) as c FROM clubs`;
      const t = await getTransferStats();
      res.writeHead(200);
      return res.end(JSON.stringify({ players: +p[0].c, clubs: +c[0].c, transfers: t, syncing: isSyncing }));
    }

    if (url.pathname === '/api/sync' && req.method === 'POST') {
      if (req.headers['authorization'] !== `Bearer ${SECRET}`) {
        res.writeHead(401);
        return res.end(JSON.stringify({ error: 'unauthorized' }));
      }
      if (isSyncing) {
        res.writeHead(409);
        return res.end(JSON.stringify({ error: 'already syncing' }));
      }
      fullSync().catch(console.error);
      res.writeHead(202);
      return res.end(JSON.stringify({ status: 'started' }));
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  });

  server.listen(PORT, () => {
    console.log(`[HTTP] 🌐 Port ${PORT}`);
  });
}

async function main() {
  console.log(`${'═'.repeat(50)}`);
  console.log(`[TM Worker] 🚀 Starting...`);
  console.log(`[TM Worker] TM API: ${process.env.TM_API_URL}`);
  console.log(`[TM Worker] Neon: ${process.env.NEON_DATABASE_URL?.slice(0, 40)}...`);
  console.log(`${'═'.repeat(50)}\n`);

  const dbOk = await testConnection();
  if (!dbOk) process.exit(1);

  await initTables();
  startHttpServer();
  await fullSync();

  console.log(`[TM Worker] 💤 Waiting for /api/sync triggers...\n`);
}

main().catch(e => { console.error(e); process.exit(1); });