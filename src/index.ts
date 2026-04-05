import cron from 'node-cron';
import http from 'http';
import { testConnection, initTables, sql } from './db';
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
    // 1. Sync clubs + TOUS leurs joueurs
    const clubResult = await syncAllClubs();

    // 2. Sync top players (profils enrichis + transferts)
    const playerResult = await syncAllPlayers();

    // 3. Stats finales
    const transferStats = await getTransferStats();
    const duration = Math.round((Date.now() - start) / 1000);

    const playerCount = await sql`SELECT COUNT(*) as count FROM players`;
    const enrichedCount = await sql`SELECT COUNT(*) as count FROM players WHERE is_enriched = true`;
    const clubCount = await sql`SELECT COUNT(*) as count FROM clubs`;

    console.log(`\n${'═'.repeat(50)}`);
    console.log(`[Sync] ✅ Full sync completed in ${duration}s`);
    console.log(`[Sync] 📊 Database stats:`);
    console.log(`[Sync]    Clubs: ${clubCount[0]?.count || 0}`);
    console.log(`[Sync]    Players total: ${playerCount[0]?.count || 0} (from ${clubResult.success} club squads)`);
    console.log(`[Sync]    Players enriched: ${enrichedCount[0]?.count || 0} (${playerResult.success} synced, ${playerResult.failed} failed)`);
    console.log(`[Sync]    Squad players: ${clubResult.totalPlayers}`);
    console.log(`[Sync]    Transfers: ${transferStats.total} (${transferStats.withFee} with fee, ${transferStats.loans} loans)`);
    console.log(`${'═'.repeat(50)}\n`);

  } finally {
    isSyncing = false;
  }
}

// ═══════════════════════════════════════
// SERVEUR HTTP
// ═══════════════════════════════════════

function startHttpServer() {
  const PORT = process.env.PORT || 3000;
  const SYNC_SECRET = process.env.SYNC_SECRET || 'changeme';

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    // Health check
    if (url.pathname === '/health') {
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'ok', syncing: isSyncing }));
      return;
    }

    // Status
    if (url.pathname === '/api/status') {
      try {
        const players = await sql`SELECT COUNT(*) as count FROM players`;
        const enriched = await sql`SELECT COUNT(*) as count FROM players WHERE is_enriched = true`;
        const clubs = await sql`SELECT COUNT(*) as count FROM clubs`;
        const transfers = await getTransferStats();

        res.writeHead(200);
        res.end(JSON.stringify({
          syncing: isSyncing,
          players: Number(players[0]?.count || 0),
          playersEnriched: Number(enriched[0]?.count || 0),
          clubs: Number(clubs[0]?.count || 0),
          transfers,
        }));
      } catch (e: any) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // Trigger full sync
    if (url.pathname === '/api/sync' && req.method === 'POST') {
      const auth = req.headers['authorization'];
      if (auth !== `Bearer ${SYNC_SECRET}`) {
        res.writeHead(401);
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      if (isSyncing) {
        res.writeHead(409);
        res.end(JSON.stringify({ error: 'sync already in progress' }));
        return;
      }

      fullSync().catch(e => console.error('[Sync] Fatal:', e));
      res.writeHead(202);
      res.end(JSON.stringify({ status: 'full sync started' }));
      return;
    }

    // Trigger quick refresh
    if (url.pathname === '/api/sync/quick' && req.method === 'POST') {
      const auth = req.headers['authorization'];
      if (auth !== `Bearer ${SYNC_SECRET}`) {
        res.writeHead(401);
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }

      (async () => {
        for (const name of TOP_PLAYERS.slice(0, 10)) {
          await syncOnePlayer(name);
          await sleep(2000);
        }
        console.log('[Sync] ✅ Quick refresh done');
      })().catch(e => console.error('[Sync] Quick error:', e));

      res.writeHead(202);
      res.end(JSON.stringify({ status: 'quick refresh started' }));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  });

  server.listen(PORT, () => {
    console.log(`[HTTP] 🌐 Listening on port ${PORT}`);
    console.log(`[HTTP]   GET  /health`);
    console.log(`[HTTP]   GET  /api/status`);
    console.log(`[HTTP]   POST /api/sync`);
    console.log(`[HTTP]   POST /api/sync/quick\n`);
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

  // Test DB
  const dbOk = await testConnection();
  if (!dbOk) {
    console.error('[TM Worker] ❌ Cannot connect to Neon. Exiting.');
    process.exit(1);
  }

  // Crée les tables si elles n'existent pas
  await initTables();

  // Serveur HTTP (pour trigger manuel)
  startHttpServer();

  // Sync immédiat
  await fullSync();

  // Crons
  cron.schedule('0 4 * * *', () => {
    console.log(`[Cron] ⏰ Daily sync`);
    fullSync().catch(e => console.error('[Sync] Fatal:', e));
  });

  cron.schedule('0 */6 * * *', async () => {
    console.log(`[Cron] ⏰ Quick refresh`);
    for (const name of TOP_PLAYERS.slice(0, 10)) {
      await syncOnePlayer(name);
      await sleep(2000);
    }
  });

  console.log(`[TM Worker] 📅 Crons: full=04:00 UTC, quick=every 6h`);
  console.log(`[TM Worker] 💤 Waiting...\n`);
}

main().catch(e => {
  console.error('[TM Worker] Fatal:', e);
  process.exit(1);
});