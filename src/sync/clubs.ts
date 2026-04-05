import { searchClub, getClubProfile, getClubPlayers, sleep } from '../tm-client';
import { upsertClub, upsertPlayer } from '../db';

export const TOP_CLUBS = [
  'Manchester City', 'Arsenal', 'Liverpool', 'Chelsea',
  'Manchester United', 'Tottenham Hotspur', 'Newcastle United',
  'Aston Villa', 'Brighton', 'West Ham United',
  'Real Madrid', 'Barcelona', 'Atletico Madrid', 'Real Sociedad',
  'Athletic Bilbao', 'Villarreal', 'Sevilla', 'Real Betis',
  'Bayern Munich', 'Borussia Dortmund', 'Bayer Leverkusen',
  'RB Leipzig', 'VfB Stuttgart', 'Eintracht Frankfurt',
  'Inter Milan', 'AC Milan', 'Juventus', 'Napoli',
  'Roma', 'Atalanta', 'Lazio',
  'Paris Saint-Germain', 'Marseille', 'Lyon',
  'Monaco', 'Lille', 'Lens',
  'Benfica', 'Porto', 'Ajax', 'Celtic',
];

function safeString(val: any): string | undefined {
  if (val === null || val === undefined) return undefined;
  if (typeof val === 'object') return val.value || val.name || String(val);
  return String(val);
}

// ═══════════════════════════════════════
// SYNC UN CLUB + TOUS SES JOUEURS
// ═══════════════════════════════════════

export async function syncOneClub(name: string): Promise<{
  clubOk: boolean;
  playersInserted: number;
}> {
  try {
    const results = await searchClub(name);
    if (!results || results.length === 0) {
      console.log(`[Sync] ❌ Club not found: ${name}`);
      return { clubOk: false, playersInserted: 0 };
    }

    const clubId = results[0].id;
    const profile = await getClubProfile(clubId);
    if (!profile) {
      console.log(`[Sync] ❌ No club profile: ${name}`);
      return { clubOk: false, playersInserted: 0 };
    }

    // Upsert club
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

    // Récupérer TOUS les joueurs du club
    await sleep(1000);
    const playersData = await getClubPlayers(String(clubId));

    const playersList = playersData?.players
      || (Array.isArray(playersData) ? playersData : []);

    let playersInserted = 0;

    if (Array.isArray(playersList)) {
      for (const p of playersList) {
        try {
          let position: string | undefined;
          if (typeof p.position === 'object' && p.position !== null) {
            position = p.position.main || p.position.name || p.position.value;
          } else {
            position = safeString(p.position);
          }

          await upsertPlayer({
            id: String(p.id),
            name: p.name || p.playerName || 'Unknown',
            fullName: safeString(p.fullName || p.name),
            imageUrl: safeString(p.image || p.imageUrl),
            dateOfBirth: safeString(p.dateOfBirth),
            age: p.age ? Number(p.age) : undefined,
            nationality: p.nationality
              ? (Array.isArray(p.nationality) ? p.nationality.map(String) : [String(p.nationality)])
              : [],
            position,
            shirtNumber: p.shirtNumber ? Number(p.shirtNumber) : undefined,
            clubId: String(clubId),
            clubName: profile.name || name,
            clubImage: safeString(profile.image),
            marketValue: p.marketValue?.value ?? p.marketValue,
            contractUntil: safeString(p.contractExpiryDate || p.contractUntil),
            agent: typeof p.agent === 'object' ? p.agent?.name : safeString(p.agent),
            foot: safeString(p.foot),
            height: safeString(p.height),
            isEnriched: false, // Données basiques, pas enrichies
          });

          playersInserted++;
        } catch {
          // Skip silencieusement
        }
      }
    }

    console.log(`[Sync] ✅ Club: ${name} (${playersInserted}/${playersList.length || 0} players saved)`);
    return { clubOk: true, playersInserted };

  } catch (e: any) {
    console.log(`[Sync] Error club ${name}: ${e.message?.slice(0, 50)}`);
    return { clubOk: false, playersInserted: 0 };
  }
}

// ═══════════════════════════════════════
// SYNC TOUS LES CLUBS
// ═══════════════════════════════════════

export async function syncAllClubs(): Promise<{
  success: number;
  failed: number;
  totalPlayers: number;
}> {
  let success = 0;
  let failed = 0;
  let totalPlayers = 0;

  console.log(`\n[Sync] 🏟️ Syncing ${TOP_CLUBS.length} clubs + squads...\n`);

  for (const name of TOP_CLUBS) {
    const result = await syncOneClub(name);
    if (result.clubOk) {
      success++;
      totalPlayers += result.playersInserted;
    } else {
      failed++;
    }
    await sleep(1500);
  }

  console.log(`\n[Sync] Clubs: ${success} ✅ / ${failed} ❌`);
  console.log(`[Sync] Squad players saved: ${totalPlayers} 🎯\n`);

  return { success, failed, totalPlayers };
}