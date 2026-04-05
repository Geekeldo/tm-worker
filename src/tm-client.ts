import * as cheerio from 'cheerio';

const TM_BASE = 'https://www.transfermarkt.com';
const TM_API = process.env.TM_API_URL;

const HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate, br',
  'DNT': '1',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Cache-Control': 'max-age=0',
};

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════
// FETCH HTML
// ═══════════════════════════════════════

async function fetchHtml(url: string, retries = 2): Promise<string | null> {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(15000),
        redirect: 'follow',
      });

      if (res.status === 404) return null;
      if (res.status === 429) {
        console.log(`[TM] Rate limited, waiting 60s...`);
        await sleep(60000);
        continue;
      }
      if (res.status === 403 || res.status === 405) {
        console.log(`[TM] Blocked (${res.status}) ${url.slice(0, 60)}`);
        if (i < retries) await sleep(5000);
        continue;
      }
      if (!res.ok) {
        console.log(`[TM] ${res.status} ${url.slice(0, 60)}`);
        if (i < retries) await sleep(3000);
        continue;
      }

      return await res.text();
    } catch (e: any) {
      if (i < retries) {
        await sleep(3000);
      } else {
        console.log(`[TM] Failed: ${url.slice(0, 50)} - ${e.message?.slice(0, 40)}`);
        return null;
      }
    }
  }
  return null;
}

// ═══════════════════════════════════════
// FETCH JSON (API TM si elle marche)
// ═══════════════════════════════════════

async function tmApiFetch(path: string): Promise<any> {
  if (!TM_API) return null;
  try {
    const res = await fetch(`${TM_API}${path}`, {
      signal: AbortSignal.timeout(10000),
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.detail) return null; // Erreur TM API
    return data;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════
// CLUB PROFILE
// ═══════════════════════════════════════

export async function getClubProfile(clubId: string): Promise<any> {
  // Essaie l'API
  const api = await tmApiFetch(`/clubs/${clubId}/profile`);
  if (api) return api;

  // Scrape
  const html = await fetchHtml(`${TM_BASE}/-/datenfakten/verein/${clubId}`);
  if (!html) return null;

  try {
    const $ = cheerio.load(html);

    const name = $('h1.data-header__headline-wrapper').first().text().trim()
      || $('h1').first().text().trim();

    if (!name) return null;

    const image = $('img.data-header__profile-image').attr('src') || '';

    const leagueName = $('span.data-header__club a').first().text().trim();
    const leagueLink = $('span.data-header__club a').first().attr('href') || '';
    const leagueId = leagueLink.match(/wettbewerb\/(\w+)/)?.[1] || '';

    const coachName = $('a[href*="/trainer/"]').first().text().trim();

    return {
      id: clubId,
      name,
      image,
      league: { id: leagueId, name: leagueName },
      squad: { size: null, averageAge: null, marketValue: null },
      stadium: { name: null, seats: null },
      coach: { name: coachName || null },
    };
  } catch (e: any) {
    console.log(`[TM] Parse error club ${clubId}: ${e.message?.slice(0, 50)}`);
    return null;
  }
}

// ═══════════════════════════════════════
// CLUB PLAYERS
// ═══════════════════════════════════════

export async function getClubPlayers(clubId: string): Promise<any> {
  // Essaie l'API
  const api = await tmApiFetch(`/clubs/${clubId}/players`);
  if (api) return api;

  // Scrape
  const html = await fetchHtml(`${TM_BASE}/-/kader/verein/${clubId}/saison_id/2025/plus/1`);
  if (!html) return null;

  try {
    const $ = cheerio.load(html);
    const players: any[] = [];

    $('table.items tbody tr.odd, table.items tbody tr.even').each((_, row) => {
      try {
        const $row = $(row);
        const nameEl = $row.find('td.hauptlink a').first();
        const name = nameEl.text().trim();
        const link = nameEl.attr('href') || '';
        const id = link.match(/\/(\d+)$/)?.[1] || '';

        if (!name || !id) return;

        const image = $row.find('img.bilderrahmen-fixed').attr('data-src')
          || $row.find('img.bilderrahmen-fixed').attr('src') || '';
        const position = $row.find('td.posrela table tr:last-child td').text().trim();
        const nationality = $row.find('img.flaggenrahmen')
          .map((_, img) => $(img).attr('title') || '').get().filter(Boolean);
        const shirtText = $row.find('div.rn_nummer').text().trim();
        const mvText = $row.find('td.rechts.hauptlink a').text().trim();

        players.push({
          id, name, image, position,
          nationality,
          shirtNumber: parseInt(shirtText) || undefined,
          marketValue: mvText || undefined,
        });
      } catch { /* skip */ }
    });

    return { players };
  } catch (e: any) {
    console.log(`[TM] Parse error players ${clubId}: ${e.message?.slice(0, 50)}`);
    return null;
  }
}

// ═══════════════════════════════════════
// PLAYER PROFILE
// ═══════════════════════════════════════

export async function getPlayerProfile(playerId: string): Promise<any> {
  const api = await tmApiFetch(`/players/${playerId}/profile`);
  if (api) return api;

  const html = await fetchHtml(`${TM_BASE}/-/profil/spieler/${playerId}`);
  if (!html) return null;

  try {
    const $ = cheerio.load(html);

    const name = $('h1.data-header__headline-wrapper').first().text().trim()
      || $('h1').first().text().trim();
    if (!name) return null;

    const image = $('img.data-header__profile-image').attr('src') || '';
    const mvText = $('a.data-header__market-value-wrapper').text().trim();

    const getInfo = (label: string): string => {
      return $(`span.info-table__content--regular:contains("${label}")`)
        .closest('.info-table__content')
        .find('.info-table__content--bold')
        .text().trim();
    };

    const nationality = $('span.info-table__content--regular:contains("Citizenship")')
      .closest('.info-table__content')
      .find('img.flaggenrahmen')
      .map((_, img) => $(img).attr('title') || '').get().filter(Boolean);

    const clubEl = $('span.data-header__club a').first();
    const clubName = clubEl.text().trim();
    const clubLink = clubEl.attr('href') || '';
    const clubIdVal = clubLink.match(/\/(\d+)$/)?.[1] || '';
    const shirtText = $('span.data-header__shirt-number').text().trim();

    return {
      id: playerId,
      name,
      fullName: getInfo('Full name') || getInfo('Name in home country') || name,
      imageUrl: image,
      dateOfBirth: getInfo('Date of birth'),
      age: parseInt(getInfo('Age')) || undefined,
      nationality,
      position: getInfo('Position'),
      foot: getInfo('Foot'),
      height: getInfo('Height'),
      shirtNumber: parseInt(shirtText.replace('#', '')) || undefined,
      marketValue: mvText || undefined,
      contractExpiryDate: getInfo('Contract expires'),
      agent: getInfo('Player agent'),
      club: { id: clubIdVal, name: clubName, image: '' },
    };
  } catch (e: any) {
    console.log(`[TM] Parse error player ${playerId}: ${e.message?.slice(0, 50)}`);
    return null;
  }
}

// ═══════════════════════════════════════
// PLAYER TRANSFERS
// ═══════════════════════════════════════

export async function getPlayerTransfers(playerId: string): Promise<any> {
  const api = await tmApiFetch(`/players/${playerId}/transfers`);
  if (api) return api;

  const html = await fetchHtml(`${TM_BASE}/-/transfers/spieler/${playerId}`);
  if (!html) return { transfers: [] };

  try {
    const $ = cheerio.load(html);
    const transfers: any[] = [];

    $('div.box:contains("Transfer history") table.items tbody tr').each((_, row) => {
      try {
        const $row = $(row);
        const season = $row.find('td.zentriert:first-child').text().trim();
        const date = $row.find('td.zentriert:nth-child(2)').text().trim();
        const fromEl = $row.find('td:nth-child(4) a');
        const toEl = $row.find('td:nth-child(5) a');
        const feeText = $row.find('td.rechts a, td.rechts').last().text().trim();

        if (fromEl.text().trim() || toEl.text().trim()) {
          transfers.push({
            season, date,
            from: { id: fromEl.attr('href')?.match(/\/(\d+)$/)?.[1], name: fromEl.text().trim() },
            to: { id: toEl.attr('href')?.match(/\/(\d+)$/)?.[1], name: toEl.text().trim() },
            fee: feeText || undefined,
            isLoan: feeText.toLowerCase().includes('loan'),
          });
        }
      } catch { /* skip */ }
    });

    return { transfers };
  } catch {
    return { transfers: [] };
  }
}

// ═══════════════════════════════════════
// SEARCH PLAYER
// ═══════════════════════════════════════

export async function searchPlayer(name: string): Promise<any[]> {
  if (TM_API) {
    const data = await tmApiFetch(`/players/search/${encodeURIComponent(name)}`);
    if (data?.results?.length > 0) return data.results;
  }

  const html = await fetchHtml(
    `${TM_BASE}/schnellsuche/ergebnis/schnellsuche?query=${encodeURIComponent(name)}&Spieler_page=0`
  );
  if (!html) return [];

  try {
    const $ = cheerio.load(html);
    const results: any[] = [];
    $('table.items tbody tr').each((_, row) => {
      const nameEl = $(row).find('td.hauptlink a').first();
      const id = nameEl.attr('href')?.match(/\/(\d+)$/)?.[1];
      if (nameEl.text().trim() && id) {
        results.push({ id, name: nameEl.text().trim() });
      }
    });
    return results;
  } catch { return []; }
}

export async function searchClub(name: string): Promise<any[]> {
  return [];
}

export async function getCompetitionClubs(competitionId: string): Promise<any> {
  return tmApiFetch(`/competitions/${competitionId}/clubs`);
}

export const COMPETITION_IDS: Record<string, string> = {
  'premier-league': 'GB1',
  'la-liga': 'ES1',
  'bundesliga': 'L1',
  'serie-a': 'IT1',
  'ligue-1': 'FR1',
};