const TM_API = process.env.TM_API_URL!;

if (!TM_API) {
  throw new Error('TM_API_URL is required');
}

// ═══════════════════════════════════════
// FETCH HELPER avec retry
// ═══════════════════════════════════════

async function tmFetch(path: string, retries = 2): Promise<any> {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(`${TM_API}${path}`, {
        signal: AbortSignal.timeout(10000),
        headers: { 'Accept': 'application/json' },
      });

      if (res.status === 404) return null;
      if (res.status === 429) {
        console.log(`[TM] Rate limited, waiting 30s...`);
        await sleep(30000);
        continue;
      }
      if (!res.ok) {
        console.log(`[TM] ${res.status} ${path}`);
        if (i < retries) await sleep(2000);
        continue;
      }

      return res.json();

    } catch (e: any) {
      if (i < retries) {
        console.log(`[TM] Retry ${i + 1}/${retries}: ${path}`);
        await sleep(2000);
      } else {
        console.log(`[TM] Failed: ${path} - ${e.message?.slice(0, 40)}`);
        return null;
      }
    }
  }
  return null;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════
// JOUEURS
// ═══════════════════════════════════════

export async function searchPlayer(name: string): Promise<any[]> {
  const data = await tmFetch(`/players/search/${encodeURIComponent(name)}`);
  return data?.results || [];
}

export async function getPlayerProfile(playerId: string): Promise<any> {
  return tmFetch(`/players/${playerId}/profile`);
}

export async function getPlayerTransfers(playerId: string): Promise<any> {
  return tmFetch(`/players/${playerId}/transfers`);
}

// ═══════════════════════════════════════
// CLUBS
// ═══════════════════════════════════════

export async function searchClub(name: string): Promise<any[]> {
  const data = await tmFetch(`/clubs/search/${encodeURIComponent(name)}`);
  return data?.results || [];
}

export async function getClubProfile(clubId: string): Promise<any> {
  return tmFetch(`/clubs/${clubId}/profile`);
}

export async function getClubPlayers(clubId: string): Promise<any> {
  return tmFetch(`/clubs/${clubId}/players`);
}

// ═══════════════════════════════════════
// COMPÉTITIONS
// ═══════════════════════════════════════

export async function getCompetitionClubs(competitionId: string): Promise<any> {
  return tmFetch(`/competitions/${competitionId}/clubs`);
}

export const COMPETITION_IDS: Record<string, string> = {
  'premier-league': 'GB1',
  'la-liga': 'ES1',
  'bundesliga': 'L1',
  'serie-a': 'IT1',
  'ligue-1': 'FR1',
  'champions-league': 'CL',
  'europa-league': 'EL',
};

// ═══════════════════════════════════════
// DELAY entre requêtes (respect du rate limit)
// ═══════════════════════════════════════

export { sleep };