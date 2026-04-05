import { searchPlayer, getPlayerProfile, getPlayerTransfers, sleep } from '../tm-client';
import { upsertPlayer, upsertTransfer } from '../db';

// ═══════════════════════════════════════
// LISTE DES TOP JOUEURS À SYNC
// ═══════════════════════════════════════

export const TOP_PLAYERS = [
  // 🏆 Superstars
  'Kylian Mbappe', 'Erling Haaland', 'Vinicius Junior', 'Jude Bellingham',
  'Lamine Yamal', 'Florian Wirtz', 'Rodri', 'Lionel Messi',
  'Cristiano Ronaldo', 'Neymar', 'Robert Lewandowski',

  // 🏴󠁧󠁢󠁥󠁮󠁧󠁿 Premier League stars
  'Bukayo Saka', 'Phil Foden', 'Cole Palmer', 'Declan Rice',
  'Martin Odegaard', 'Bruno Fernandes', 'Mohamed Salah',
  'Marcus Rashford', 'Son Heung-min', 'Kevin De Bruyne',
  'Bernardo Silva', 'Darwin Nunez', 'Alexander Isak',
  'Ollie Watkins', 'William Saliba', 'Virgil van Dijk',
  'Trent Alexander-Arnold', 'Alisson Becker',

  // 🇪🇸 La Liga
  'Pedri', 'Gavi', 'Raphinha', 'Dani Olmo', 'Antoine Griezmann',
  'Federico Valverde', 'Eduardo Camavinga', 'Aurelien Tchouameni',
  'Thibaut Courtois',

  // 🇩🇪 Bundesliga
  'Jamal Musiala', 'Harry Kane', 'Leroy Sane', 'Xavi Simons',
  'Nico Schlotterbeck',

  // 🇮🇹 Serie A
  'Lautaro Martinez', 'Rafael Leao', 'Victor Osimhen',
  'Khvicha Kvaratskhelia', 'Nicolo Barella', 'Hakan Calhanoglu',
  'Dusan Vlahovic',

  // 🇫🇷 Ligue 1
  'Ousmane Dembele', 'Achraf Hakimi', 'Gianluigi Donnarumma',
  'Bradley Barcola', 'Nico Williams',

  // 🌍 Rising stars
  'Endrick', 'Josko Gvardiol', 'Pau Cubarsi', 'Alejandro Garnacho',
  'Kobbie Mainoo', 'Warren Zaire-Emery', 'Mathys Tel',
];

// ═══════════════════════════════════════
// HELPER — Extraction safe de valeurs
// ═══════════════════════════════════════

function safeString(val: any): string | undefined {
  if (val === null || val === undefined) return undefined;
  if (typeof val === 'object') return val.value || val.name || String(val);
  return String(val);
}

// ═══════════════════════════════════════
// SYNC UN JOUEUR
// ═══════════════════════════════════════

export async function syncOnePlayer(name: string): Promise<boolean> {
  try {
    const results = await searchPlayer(name);
    if (!results || results.length === 0) {
      console.log(`[Sync] ❌ Not found: ${name}`);
      return false;
    }

    const playerId = results[0].id;
    const profile = await getPlayerProfile(playerId);
    if (!profile) {
      console.log(`[Sync] ❌ No profile: ${name}`);
      return false;
    }

    // Extraire position proprement (peut être string ou objet)
    let position: string | undefined;
    if (typeof profile.position === 'object' && profile.position !== null) {
      position = profile.position.main || profile.position.name || profile.position.value;
    } else {
      position = safeString(profile.position);
    }

    // Extraire market value proprement
    const marketValue = profile.marketValue?.value ?? profile.marketValue;

    // Extraire agent proprement
    const agent = typeof profile.agent === 'object' 
      ? profile.agent?.name 
      : safeString(profile.agent);

    // Upsert le joueur
    await upsertPlayer({
      id: String(playerId),
      name: profile.name || results[0].name,
      fullName: safeString(profile.fullName || profile.name),
      imageUrl: safeString(profile.imageUrl || results[0].imageUrl),
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
    });

    console.log(`[Sync] ✅ ${name} → ${profile.club?.name || '?'} (${safeString(marketValue) || '?'})`);

    // Sync transferts
    await sleep(1000);
    const transfers = await getPlayerTransfers(playerId);
    
    // L'API peut renvoyer {transfers: [...]} ou {transferHistory: [...]} ou directement [...]
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
// SYNC TOUS LES JOUEURS
// ═══════════════════════════════════════

export async function syncAllPlayers(): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  console.log(`\n[Sync] ⚽ Syncing ${TOP_PLAYERS.length} players...\n`);

  for (const name of TOP_PLAYERS) {
    const ok = await syncOnePlayer(name);
    if (ok) success++;
    else failed++;

    await sleep(1500);
  }

  console.log(`\n[Sync] Players done: ${success} ✅ / ${failed} ❌\n`);
  return { success, failed };
}