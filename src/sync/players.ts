import { getPlayerProfile, getPlayerTransfers, searchPlayer, sleep } from '../tm-client';
import { upsertPlayer, upsertTransfer, sql } from '../db';

export const TOP_PLAYERS = [
  'Kylian Mbappe', 'Erling Haaland', 'Vinicius Junior', 'Jude Bellingham',
  'Lamine Yamal', 'Florian Wirtz', 'Rodri', 'Lionel Messi',
  'Cristiano Ronaldo', 'Neymar', 'Robert Lewandowski',
  'Bukayo Saka', 'Phil Foden', 'Cole Palmer', 'Declan Rice',
  'Martin Odegaard', 'Bruno Fernandes', 'Mohamed Salah',
  'Marcus Rashford', 'Son Heung-min', 'Kevin De Bruyne',
  'Bernardo Silva', 'Darwin Nunez', 'Alexander Isak',
  'Ollie Watkins', 'William Saliba', 'Virgil van Dijk',
  'Trent Alexander-Arnold', 'Alisson Becker',
  'Pedri', 'Gavi', 'Raphinha', 'Dani Olmo', 'Antoine Griezmann',
  'Federico Valverde', 'Eduardo Camavinga', 'Aurelien Tchouameni',
  'Thibaut Courtois',
  'Jamal Musiala', 'Harry Kane', 'Leroy Sane', 'Xavi Simons',
  'Nico Schlotterbeck',
  'Lautaro Martinez', 'Rafael Leao', 'Victor Osimhen',
  'Khvicha Kvaratskhelia', 'Nicolo Barella', 'Hakan Calhanoglu',
  'Dusan Vlahovic',
  'Ousmane Dembele', 'Achraf Hakimi', 'Gianluigi Donnarumma',
  'Bradley Barcola', 'Nico Williams',
  'Endrick', 'Josko Gvardiol', 'Pau Cubarsi', 'Alejandro Garnacho',
  'Kobbie Mainoo', 'Warren Zaire-Emery', 'Mathys Tel',
];

function safeString(val: any): string | undefined {
  if (val === null || val === undefined) return undefined;
  if (typeof val === 'object') return val.value || val.name || String(val);
  return String(val);
}

// ═══════════════════════════════════════
// SYNC UN JOUEUR (enrichi + transferts)
// ═══════════════════════════════════════

export async function syncOnePlayer(name: string): Promise<boolean> {
  try {
    // Cherche d'abord dans la DB (déjà importé via club sync)
    const existing = await sql`
      SELECT tm_id FROM players WHERE name ILIKE ${`%${name}%`} LIMIT 1
    `;

    let playerId: string;

    if (existing.length > 0) {
      playerId = existing[0].tm_id;
    } else {
      // Sinon cherche sur TM
      const results = await searchPlayer(name);
      if (!results || results.length === 0) {
        console.log(`[Sync] ❌ Not found: ${name}`);
        return false;
      }
      playerId = String(results[0].id);
    }

    const profile = await getPlayerProfile(playerId);
    if (!profile) {
      console.log(`[Sync] ❌ No profile: ${name}`);
      return false;
    }

    let position: string | undefined;
    if (typeof profile.position === 'object' && profile.position !== null) {
      position = profile.position.main || profile.position.name || profile.position.value;
    } else {
      position = safeString(profile.position);
    }

    const marketValue = profile.marketValue?.value ?? profile.marketValue;
    const agent = typeof profile.agent === 'object'
      ? profile.agent?.name
      : safeString(profile.agent);

    await upsertPlayer({
      id: String(playerId),
      name: profile.name || name,
      fullName: safeString(profile.fullName || profile.name),
      imageUrl: safeString(profile.imageUrl || profile.image),
      dateOfBirth: safeString(profile.dateOfBirth),
      age: profile.age ? Number(profile.age) : undefined,
      nationality: profile.nationality
        ? (Array.isArray(profile.nationality) ? profile.nationality.map(String) : [String(profile.nationality)])
        : [],
      position,
      shirtNumber: profile.shirtNumber ? Number(profile.shirtNumber) : undefined,
      clubId: profile.club?.id ? String(profile.club.id) : undefined,
      clubName: safeString(profile.club?.name),
      clubImage: safeString(profile.club?.image),
      marketValue,
      contractUntil: safeString(profile.contractExpiryDate || profile.contractUntil),
      agent,
      foot: safeString(profile.foot),
      height: safeString(profile.height),
      isEnriched: true,
    });

    console.log(`[Sync] ✅ ${name} → ${profile.club?.name || '?'} (${safeString(marketValue) || '?'})`);

    // Transferts
    await sleep(1500);
    const transfers = await getPlayerTransfers(playerId);
    const transferList = transfers?.transfers
      || transfers?.transferHistory
      || (Array.isArray(transfers) ? transfers : []);

    if (Array.isArray(transferList)) {
      for (const t of transferList.slice(0, 5)) {
        await upsertTransfer({
          playerId: String(playerId),
          playerName: profile.name || name,
          fromClubId: t.from?.id ? String(t.from.id) : undefined,
          fromClubName: safeString(t.from?.name),
          toClubId: t.to?.id ? String(t.to.id) : undefined,
          toClubName: safeString(t.to?.name),
          fee: t.fee,
          season: safeString(t.season),
          date: safeString(t.date),
          isLoan: Boolean(t.isLoan),
        });
      }
    }

    return true;
  } catch (e: any) {
    console.log(`[Sync] Error ${name}: ${e.message?.slice(0, 80)}`);
    return false;
  }
}

// ═══════════════════════════════════════
// AUTO-ENRICH les plus chers non enrichis
// ═══════════════════════════════════════

export async function autoEnrichTopPlayers(limit = 50): Promise<{ success: number; failed: number }> {
  const rows = await sql`
    SELECT tm_id, name FROM players
    WHERE is_enriched = false
      AND market_value_number IS NOT NULL
      AND market_value_number > 0
    ORDER BY market_value_number DESC
    LIMIT ${limit}
  `;

  console.log(`\n[Sync] 🔬 Auto-enriching ${rows.length} players...\n`);

  let success = 0;
  let failed = 0;

  for (const row of rows) {
    const profile = await getPlayerProfile(row.tm_id);
    if (profile) {
      let position: string | undefined;
      if (typeof profile.position === 'object' && profile.position !== null) {
        position = profile.position.main || profile.position.name;
      } else {
        position = safeString(profile.position);
      }

      await upsertPlayer({
        id: row.tm_id,
        name: profile.name || row.name,
        fullName: safeString(profile.fullName),
        imageUrl: safeString(profile.imageUrl),
        dateOfBirth: safeString(profile.dateOfBirth),
        age: profile.age ? Number(profile.age) : undefined,
        nationality: profile.nationality
          ? (Array.isArray(profile.nationality) ? profile.nationality.map(String) : [String(profile.nationality)])
          : [],
        position,
        shirtNumber: profile.shirtNumber ? Number(profile.shirtNumber) : undefined,
        clubId: profile.club?.id ? String(profile.club.id) : undefined,
        clubName: safeString(profile.club?.name),
        clubImage: safeString(profile.club?.image),
        marketValue: profile.marketValue?.value ?? profile.marketValue,
        contractUntil: safeString(profile.contractExpiryDate),
        agent: typeof profile.agent === 'object' ? profile.agent?.name : safeString(profile.agent),
        foot: safeString(profile.foot),
        height: safeString(profile.height),
        isEnriched: true,
      });
      console.log(`[Sync] ✅ Enriched: ${row.name}`);
      success++;
    } else {
      failed++;
    }
    await sleep(2000);
  }

  console.log(`\n[Sync] Auto-enrich: ${success} ✅ / ${failed} ❌\n`);
  return { success, failed };
}

// ═══════════════════════════════════════
// SYNC TOUS LES TOP PLAYERS
// ═══════════════════════════════════════

export async function syncAllPlayers(): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  console.log(`\n[Sync] ⚽ Enriching ${TOP_PLAYERS.length} top players...\n`);

  for (const name of TOP_PLAYERS) {
    const ok = await syncOnePlayer(name);
    if (ok) success++;
    else failed++;
    await sleep(2000);
  }

  console.log(`\n[Sync] Players enriched: ${success} ✅ / ${failed} ❌\n`);
  return { success, failed };
}