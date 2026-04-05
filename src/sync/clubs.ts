import { searchClub, getClubProfile, sleep } from '../tm-client';
import { upsertClub } from '../db';

// ═══════════════════════════════════════
// LISTE DES TOP CLUBS À SYNC
// ═══════════════════════════════════════

export const TOP_CLUBS = [
  // 🏴󠁧󠁢󠁥󠁮󠁧󠁿 Premier League
  'Manchester City', 'Arsenal', 'Liverpool', 'Chelsea',
  'Manchester United', 'Tottenham Hotspur', 'Newcastle United',
  'Aston Villa', 'Brighton', 'West Ham United',

  // 🇪🇸 La Liga
  'Real Madrid', 'Barcelona', 'Atletico Madrid', 'Real Sociedad',
  'Athletic Bilbao', 'Villarreal', 'Sevilla', 'Real Betis',

  // 🇩🇪 Bundesliga
  'Bayern Munich', 'Borussia Dortmund', 'Bayer Leverkusen',
  'RB Leipzig', 'VfB Stuttgart', 'Eintracht Frankfurt',

  // 🇮🇹 Serie A
  'Inter Milan', 'AC Milan', 'Juventus', 'Napoli',
  'Roma', 'Atalanta', 'Lazio',

  // 🇫🇷 Ligue 1
  'Paris Saint-Germain', 'Marseille', 'Lyon',
  'Monaco', 'Lille', 'Lens',

  // 🌍 Autres
  'Benfica', 'Porto', 'Ajax', 'Celtic',
];

// ═══════════════════════════════════════
// SYNC UN CLUB
// ═══════════════════════════════════════

export async function syncOneClub(name: string): Promise<boolean> {
  try {
    const results = await searchClub(name);
    if (!results || results.length === 0) {
      console.log(`[Sync] ❌ Club not found: ${name}`);
      return false;
    }

    const clubId = results[0].id;
    const profile = await getClubProfile(clubId);
    if (!profile) {
      console.log(`[Sync] ❌ No club profile: ${name}`);
      return false;
    }

    await upsertClub({
      id: String(clubId),
      name: profile.name || results[0].name,
      imageUrl: profile.image || results[0].image,
      leagueId: profile.league?.id ? String(profile.league.id) : undefined,
      leagueName: profile.league?.name,
      country: profile.league?.country || profile.country,
      stadiumName: profile.stadium?.name,
      stadiumSeats: profile.stadium?.seats || profile.stadium?.totalCapacity,
      squadSize: profile.squad?.size,
      averageAge: profile.squad?.averageAge,
      totalMarketValue: profile.squad?.marketValue || profile.squad?.totalMarketValue,
      coachName: profile.coach?.name || profile.manager?.name,
    });

    console.log(`[Sync] ✅ Club: ${name} (${profile.squad?.size || '?'} players)`);
    return true;

  } catch (e: any) {
    console.log(`[Sync] Error club ${name}: ${e.message?.slice(0, 50)}`);
    return false;
  }
}

// ═══════════════════════════════════════
// SYNC TOUS LES CLUBS
// ═══════════════════════════════════════

export async function syncAllClubs(): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  console.log(`\n[Sync] 🏟️ Syncing ${TOP_CLUBS.length} clubs...\n`);

  for (const name of TOP_CLUBS) {
    const ok = await syncOneClub(name);
    if (ok) success++;
    else failed++;

    await sleep(1500);
  }

  console.log(`\n[Sync] Clubs done: ${success} ✅ / ${failed} ❌\n`);
  return { success, failed };
}