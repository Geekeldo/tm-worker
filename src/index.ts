import cron from 'node-cron';
import { testConnection, sql } from './db';
import { syncAllPlayers } from './sync/players';
import { syncAllClubs } from './sync/clubs';
import { getTransferStats } from './sync/transfers';

// ═══════════════════════════════════════
// FULL SYNC
// ═══════════════════════════════════════

async function fullSync() {
  const start = Date.now();
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`[Sync] 🔄 Full sync started at ${new Date().toISOString()}`);
  console.log(`${'═'.repeat(50)}\n`);

  // 1. Sync clubs d'abord (car les joueurs référencent les clubs)
  const clubResult = await syncAllClubs();

  // 2. Sync joueurs (+ leurs transferts)
  const playerResult = await syncAllPlayers();

  // 3. Stats finales
  const transferStats = await getTransferStats();

  const duration = Math.round((Date.now() - start) / 1000);

  // Résumé
  const playerCount = await sql`SELECT COUNT(*) as count FROM players`;
  const clubCount = await sql`SELECT COUNT(*) as count FROM clubs`;

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`[Sync] ✅ Full sync completed in ${duration}s`);
  console.log(`[Sync] 📊 Database stats:`);
  console.log(`[Sync]    Players: ${playerCount[0]?.count || 0} (${playerResult.success} synced, ${playerResult.failed} failed)`);
  console.log(`[Sync]    Clubs: ${clubCount[0]?.count || 0} (${clubResult.success} synced, ${clubResult.failed} failed)`);
  console.log(`[Sync]    Transfers: ${transferStats.total} (${transferStats.withFee} with fee, ${transferStats.loans} loans)`);
  console.log(`${'═'.repeat(50)}\n`);
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

  // Test la connexion DB
  const dbOk = await testConnection();
  if (!dbOk) {
    console.error('[TM Worker] ❌ Cannot connect to Neon. Exiting.');
    process.exit(1);
  }

  // Sync immédiat au démarrage
  await fullSync();

  // Puis tous les jours à 4h du matin UTC
  cron.schedule('0 4 * * *', () => {
    console.log(`[TM Worker] ⏰ Daily sync triggered`);
    fullSync().catch(e => console.error(`[Sync] Fatal:`, e));
  });

  // Refresh rapide (juste les top 10 joueurs) toutes les 6h
  cron.schedule('0 */6 * * *', async () => {
    console.log(`[TM Worker] ⏰ Quick refresh triggered`);
    const { syncOnePlayer, TOP_PLAYERS } = await import('./sync/players');
    const { sleep } = await import('./tm-client');
    for (const name of TOP_PLAYERS.slice(0, 10)) {
      await syncOnePlayer(name);
      await sleep(2000);
    }
  });

  console.log(`[TM Worker] 📅 Crons scheduled:`);
  console.log(`[TM Worker]    Full sync: daily at 04:00 UTC`);
  console.log(`[TM Worker]    Quick refresh: every 6h (top 10 players)`);
  console.log(`[TM Worker] 💤 Waiting for next cron...\n`);
}

main().catch(e => {
  console.error('[TM Worker] Fatal error:', e);
  process.exit(1);
});