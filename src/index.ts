import cron from 'node-cron';
import http from 'http';
import { testConnection, sql } from './db';
import { syncAllPlayers, syncOnePlayer, TOP_PLAYERS } from './sync/players';
import { syncAllClubs } from './sync/clubs';
import { getTransferStats } from './sync/transfers';
import { sleep } from './tm-client';

// ═══════════════════════════════════════
// FULL SYNC
// ═══════════════════════════════════════

let isSyncing = false;

async function fullSync() {
  if (isSyncing) {
    console.log('[Sync] ⚠️ Already syncing, skipping...');
    return;
  }
  isSyncing = true;

  const start = Date.now();
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`[Sync] 🔄 Full sync started at ${new Date().toISOString()}`);
  console.log(`${'═'.repeat(50)}\n`);

  try {
    // 1. Sync clubs d'abord
    const clubResult = await syncAllClubs();

    // 2. Sync joueurs (+ leurs transferts)
    const playerResult = await syncAllPlayers();

    // 3. Stats finales
    const transferStats = await getTransferStats();
    const duration = Math.round((Date.now() - start) / 1000);

    const playerCount = await sql`SELECT COUNT(*) as count FROM players`;
    const clubCount = await sql`SELECT COUNT(*) as count FROM clubs`;

    console.log(`\n${'═'.repeat(50)}`);
    console.log(`[Sync] ✅ Full sync completed in ${duration}s`);
    console.log(`[Sync] 📊 Database stats:`);
    console.log(`[Sync]    Players: ${playerCount[0]?.count || 0} (${playerResult.success} synced, ${playerResult.failed} failed)`);
    console.log(`[Sync]    Clubs: ${clubCount[0]?.count || 0} (${clubResult.success} synced, ${clubResult.failed} failed)`);
    console.log(`[Sync]    Transfers: ${transferStats.total} (${transferStats.withFee} with fee, ${transferStats.loans} loans)`);
    console.log(`${'═'.repeat(50)}\n`);
  } finally {
    isSyncing = false;
  }
}

// ═══════════════════════════════════════
// SERVEUR HTTP — Pour trigger manuel + health check
// ═══════════════════════════════════════

function startHttpServer() {
  const PORT = process.env.PORT || 3000;
  const SYNC_SECRET = process.env.SYNC_SECRET || 'changeme';

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);

    // Health check
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', syncing: isSyncing }));
      return;
    }

    // Trigger full sync
    if (url.pathname === '/api/sync' && req.method === 'POST') {
      const auth = req.headers['authorization'];
      if (auth !== `Bearer ${SYNC_SECRET}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }

      if (isSyncing) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'sync already in progress' }));
        return;
      }

      // Lance le sync en background
      fullSync().catch(e => console.error('[Sync] Fatal:', e));
      
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'sync started' }));
      return;
    }

    // Trigger quick refresh (top 10)
    if (url.pathname === '/api/sync/quick' && req.method === 'POST') {
      const auth = req.headers['authorization'];
      if (auth !== `Bearer ${SYNC_SECRET}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }

      // Quick refresh en background
      (async () => {
        for (const name of TOP_PLAYERS.slice(0, 10)) {
          await syncOnePlayer(name);
          await sleep(2000);
        }
      })().catch(e => console.error('[Sync] Quick refresh error:', e));

      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'quick refresh started' }));
      return;
    }

    // Status
    if (url.pathname === '/api/status') {
      try {
        const playerCount = await sql`SELECT COUNT(*) as count FROM players`;
        const clubCount = await sql`SELECT COUNT(*) as count FROM clubs`;
        const transferStats = await getTransferStats();
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          syncing: isSyncing,
          players: Number(playerCount[0]?.count || 0),
          clubs: Number(clubCount[0]?.count || 0),
          transfers: transferStats,
        }));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(PORT, () => {
    console.log(`[HTTP] 🌐 Server listening on port ${PORT}`);
    console.log(`[HTTP] Endpoints:`);
    console.log(`[HTTP]   GET  /health       — Health check`);
    console.log(`[HTTP]   GET  /api/status   — DB stats`);
    console.log(`[HTTP]   POST /api/sync     — Trigger full sync`);
    console.log(`[HTTP]   POST /api/sync/quick — Trigger quick refresh`);
  });
}

// ═══════════════════════════════════════
// DÉMARRAGE
// ═══════════════════════════════════════

async function main() {
  console.log(`${'═'.repeat(50)}`);
  console.log(`[TM Worker] 🚀 Starting...`);
  console.log(`[TM Worker] TM API: ${process.env.TM_API_URL}`);
  console.log(`[TM Worker] Neon: ${process.env.NEON_DATABASE_URL?.slice(0, 40)}...`);
  console.log(`${'═'.repeat(50)}\n`);

  const dbOk = await testConnection();
  if (!dbOk) {
    console.error('[TM Worker] ❌ Cannot connect to Neon. Exiting.');
    process.exit(1);
  }

  // Démarrer le serveur HTTP
  startHttpServer();

  // Sync immédiat au démarrage
  await fullSync();

  // Cron: Full sync quotidien à 4h UTC
  cron.schedule('0 4 * * *', () => {
    console.log(`[TM Worker] ⏰ Daily sync triggered`);
    fullSync().catch(e => console.error('[Sync] Fatal:', e));
  });

  // Cron: Quick refresh toutes les 6h
  cron.schedule('0 */6 * * *', async () => {
    console.log(`[TM Worker] ⏰ Quick refresh triggered`);
    for (const name of TOP_PLAYERS.slice(0, 10)) {
      await syncOnePlayer(name);
      await sleep(2000);
    }
  });

  console.log(`[TM Worker] 📅 Crons scheduled:`);
  console.log(`[TM Worker]    Full sync: daily at 04:00 UTC`);
  console.log(`[TM Worker]    Quick refresh: every 6h (top 10 players)`);
  console.log(`[TM Worker] 💤 Waiting for next trigger...\n`);
}

main().catch(e => {
  console.error('[TM Worker] Fatal error:', e);
  process.exit(1);
});