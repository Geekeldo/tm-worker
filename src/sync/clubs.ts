import { getClubProfile, getClubPlayers, sleep } from '../tm-client';
import { upsertClub, upsertPlayer } from '../db';

// ═══════════════════════════════════════
// CLUBS AVEC IDS TRANSFERMARKT DIRECTS
// ═══════════════════════════════════════

export const TOP_CLUBS: { name: string; tmId: string }[] = [
  // 🏴󠁧󠁢󠁥󠁮󠁧󠁿 Premier League
  { name: 'Manchester City', tmId: '281' },
  { name: 'Arsenal', tmId: '11' },
  { name: 'Liverpool', tmId: '31' },
  { name: 'Chelsea', tmId: '631' },
  { name: 'Manchester United', tmId: '985' },
  { name: 'Tottenham Hotspur', tmId: '148' },
  { name: 'Newcastle United', tmId: '762' },
  { name: 'Aston Villa', tmId: '405' },
  { name: 'Brighton', tmId: '1237' },
  { name: 'West Ham United', tmId: '379' },
  { name: 'Crystal Palace', tmId: '873' },
  { name: 'Fulham', tmId: '931' },
  { name: 'Wolverhampton', tmId: '543' },
  { name: 'Bournemouth', tmId: '989' },
  { name: 'Nottingham Forest', tmId: '703' },
  { name: 'Everton', tmId: '29' },
  { name: 'Brentford', tmId: '1148' },
  { name: 'Leicester City', tmId: '1003' },
  { name: 'Ipswich Town', tmId: '677' },
  { name: 'Southampton', tmId: '180' },

  // 🇪🇸 La Liga
  { name: 'Real Madrid', tmId: '418' },
  { name: 'Barcelona', tmId: '131' },
  { name: 'Atletico Madrid', tmId: '13' },
  { name: 'Real Sociedad', tmId: '681' },
  { name: 'Athletic Bilbao', tmId: '621' },
  { name: 'Villarreal', tmId: '1050' },
  { name: 'Sevilla', tmId: '368' },
  { name: 'Real Betis', tmId: '150' },
  { name: 'Girona', tmId: '12321' },
  { name: 'Celta Vigo', tmId: '940' },

  // 🇩🇪 Bundesliga
  { name: 'Bayern Munich', tmId: '27' },
  { name: 'Borussia Dortmund', tmId: '16' },
  { name: 'Bayer Leverkusen', tmId: '15' },
  { name: 'RB Leipzig', tmId: '23826' },
  { name: 'VfB Stuttgart', tmId: '79' },
  { name: 'Eintracht Frankfurt', tmId: '24' },
  { name: 'Wolfsburg', tmId: '82' },
  { name: 'Freiburg', tmId: '60' },

  // 🇮🇹 Serie A
  { name: 'Inter Milan', tmId: '46' },
  { name: 'AC Milan', tmId: '5' },
  { name: 'Juventus', tmId: '506' },
  { name: 'Napoli', tmId: '6195' },
  { name: 'Roma', tmId: '12' },
  { name: 'Atalanta', tmId: '800' },
  { name: 'Lazio', tmId: '398' },
  { name: 'Fiorentina', tmId: '430' },
  { name: 'Bologna', tmId: '1025' },

  // 🇫🇷 Ligue 1
  { name: 'Paris Saint-Germain', tmId: '583' },
  { name: 'Marseille', tmId: '244' },
  { name: 'Lyon', tmId: '1041' },
  { name: 'Monaco', tmId: '162' },
  { name: 'Lille', tmId: '1082' },
  { name: 'Lens', tmId: '826' },
  { name: 'Nice', tmId: '417' },
  { name: 'Rennes', tmId: '273' },

  // 🇵🇹 Portugal
  { name: 'Benfica', tmId: '294' },
  { name: 'Porto', tmId: '720' },
  { name: 'Sporting CP', tmId: '336' },

  // 🇳🇱 Eredivisie
  { name: 'Ajax', tmId: '610' },
  { name: 'PSV', tmId: '383' },
  { name: 'Feyenoord', tmId: '234' },

  // 🏴󠁧󠁢󠁳󠁣󠁴󠁿 Scottish
  { name: 'Celtic', tmId: '371' },
  { name: 'Rangers', tmId: '124' },

  // 🇹🇷 Turquie
  { name: 'Galatasaray', tmId: '141' },
  { name: 'Fenerbahce', tmId: '36' },

  // 🇸🇦 Saudi
  { name: 'Al-Hilal', tmId: '10533' },
  { name: 'Al-Nassr', tmId: '18543' },
];

function safeString(val: any): string | undefined {
  if (val === null || val === undefined) return undefined;
  if (typeof val === 'object') return val.value || val.name || String(val);
  return String(val);
}

// ═══════════════════════════════════════
// SYNC UN CLUB + SES JOUEURS (par ID direct)
// ═══════════════════════════════════════

export async function syncOneClub(club: { name: string; tmId: string }): Promise<{
  clubOk: boolean;
  playersInserted: number;
}> {
  try {
    const profile = await getClubProfile(club.tmId);
    if (!profile) {
      console.log(`[Sync] ❌ No profile: ${club.name} (ID: ${club.tmId})`);
      return { clubOk: false, playersInserted: 0 };
    }

    await upsertClub({
      id: club.tmId,
      name: profile.name || club.name,
      imageUrl: safeString(profile.image),
      leagueId: profile.league?.id ? String(profile.league.id) : undefined,
      leagueName: safeString(profile.league?.name),
      country: safeString(profile.league?.country || profile.country),
      stadiumName: safeString(profile.stadium?.name),
      stadiumSeats: profile.stadium?.seats || profile.stadium?.totalCapacity,
      squadSize: profile.squad?.size,
      averageAge: profile.squad?.averageAge,
      totalMarketValue: profile.squad?.marketValue || profile.squad?.totalMarketValue,
      coachName: safeString(profile.coach?.name || profile.manager?.name),
    });

    await sleep(1500);
    const playersData = await getClubPlayers(club.tmId);

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
            clubId: club.tmId,
            clubName: profile.name || club.name,
            clubImage: safeString(profile.image),
            marketValue: p.marketValue?.value ?? p.marketValue,
            contractUntil: safeString(p.contractExpiryDate || p.contractUntil),
            agent: typeof p.agent === 'object' ? p.agent?.name : safeString(p.agent),
            foot: safeString(p.foot),
            height: safeString(p.height),
            isEnriched: false,
          });

          playersInserted++;
        } catch {
          // Skip
        }
      }
    }

    console.log(`[Sync] ✅ ${club.name} (${playersInserted}/${playersList.length || 0} players)`);
    return { clubOk: true, playersInserted };

  } catch (e: any) {
    console.log(`[Sync] Error ${club.name}: ${e.message?.slice(0, 60)}`);
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

  for (const club of TOP_CLUBS) {
    const result = await syncOneClub(club);
    if (result.clubOk) {
      success++;
      totalPlayers += result.playersInserted;
    } else {
      failed++;
    }
    await sleep(2500);
  }

  console.log(`\n[Sync] Clubs: ${success} ✅ / ${failed} ❌`);
  console.log(`[Sync] Squad players: ${totalPlayers} 🎯\n`);

  return { success, failed, totalPlayers };
}