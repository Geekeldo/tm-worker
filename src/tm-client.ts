import * as cheerio from 'cheerio';

// ═══════════════════════════════════════
// DIRECT TRANSFERMARKT SCRAPER
// Plus besoin d'API intermédiaire !
// ═══════════════════════════════════════

const TM_BASE = 'https://www.transfermarkt.com';

const HEADERS = {
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

// ═══════════════════════════════════════
// SLEEP
// ═══════════════════════════════════════

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════
// FETCH HTML avec retry
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
        console.log(`[TM] Blocked (${res.status}), waiting 30s...`);
        await sleep(30000);
        continue;
      }

      if (!res.ok) {
        console.log(`[TM] ${res.status} ${url.slice(0, 80)}`);
        if (i < retries) await sleep(3000);
        continue;
      }

      return await res.text();

    } catch (e: any) {
      if (i < retries) {
        console.log(`[TM] Retry ${i + 1}/${retries}`);
        await sleep(3000);
      } else {
        console.log(`[TM] Failed: ${url.slice(0, 60)} - ${e.message?.slice(0, 40)}`);
        return null;
      }
    }
  }
  return null;
}

// ═══════════════════════════════════════
// FETCH JSON (pour l'API TM si elle remarche)
// ═══════════════════════════════════════

const TM_API = process.env.TM_API_URL;

async function tmApiFetch(path: string, retries = 1): Promise<any> {
  if (!TM_API) return null;

  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(`${TM_API}${path}`, {
        signal: AbortSignal.timeout(10000),
        headers: { 'Accept': 'application/json' },
      });

      if (!res.ok) return null;
      return await res.json();
    } catch {
      if (i < retries) await sleep(2000);
    }
  }
  return null;
}

// ═══════════════════════════════════════
// CLUB PROFILE — Scrape direct
// ═══════════════════════════════════════

export async function getClubProfile(clubId: string): Promise<any> {
  // Essaie l'API d'abord (si elle marche)
  const apiResult = await tmApiFetch(`/clubs/${clubId}/profile`);
  if (apiResult && !apiResult.detail) return apiResult;

  // Sinon scrape directement transfermarkt.com
  const html = await fetchHtml(`${TM_BASE}/-/datenfakten/verein/${clubId}`);
  if (!html) return null;

  try {
    const $ = cheerio.load(html);

    const name = $('h1.data-header__headline-wrapper').text().trim()
      || $('[data-header-headline]').text().trim()
      || $('h1').first().text().trim();

    const image = $('img.data-header__profile-image').attr('src')
      || $('img[data-header-profile-image]').attr('src')
      || '';

    // League info
    const leagueName = $('span.data-header__club a').text().trim()
      || $('a[data-league]').text().trim();
    const leagueLink = $('span.data-header__club a').attr('href') || '';
    const leagueId = leagueLink.match(/wettbewerb\/(\w+)/)?.[1] || '';

    // Squad info
    const squadText = $('li.data-header__details-element:contains("Squad size")').text();
    const squadSize = parseInt(squadText.match(/(\d+)/)?.[1] || '0');

    const avgAgeText = $('li.data-header__details-element:contains("Average age")').text();
    const averageAge = parseFloat(avgAgeText.match(/([\d.]+)/)?.[1] || '0');

    // Market value
    const mvText = $('a.data-header__market-value-wrapper').text().trim();

    // Stadium
    const stadiumName = $('li.data-header__details-element:contains("Stadium") a').text().trim();
    const stadiumSeatsText = $('li.data-header__details-element:contains("Stadium")').text();
    const stadiumSeats = parseInt(stadiumSeatsText.replace(/\D/g, '') || '0');

    // Coach
    const coachName = $('div.container-hauptinfo a[href*="/trainer/"]').text().trim()
      || $('a.data-header__box--big-text').text().trim();

    if (!name) return null;

    return {
      id: clubId,
      name,
      image,
      league: { id: leagueId, name: leagueName },
      squad: { size: squadSize || null, averageAge: averageAge || null, marketValue: mvText || null },
      stadium: { name: stadiumName || null, seats: stadiumSeats || null },
      coach: { name: coachName || null },
    };
  } catch (e: any) {
    console.log(`[TM] Parse error club ${clubId}: ${e.message?.slice(0, 50)}`);
    return null;
  }
}

// ═══════════════════════════════════════
// CLUB PLAYERS — Scrape direct
// ═══════════════════════════════════════

export async function getClubPlayers(clubId: string): Promise<any> {
  // Essaie l'API d'abord
  const apiResult = await tmApiFetch(`/clubs/${clubId}/players`);
  if (apiResult && !apiResult.detail) return apiResult;

  // Scrape la page squad
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
        const playerLink = nameEl.attr('href') || '';
        const idMatch = playerLink.match(/\/(\d+)$/);
        const id = idMatch ? idMatch[1] : '';

        if (!name || !id) return;

        const image = $row.find('img.bilderrahmen-fixed').attr('data-src')
          || $row.find('img.bilderrahmen-fixed').attr('src')
          || '';

        const position = $row.find('td.posrela table tr:last-child td').text().trim()
          || '';

        const dobText = $row.find('td.zentriert:nth-child(3)').text().trim();
        const ageText = $row.find('td.zentriert:nth-child(4)').text().trim();

        const nationality = $row.find('td.zentriert img.flaggenrahmen')
          .map((_, img) => $(img).attr('title') || '')
          .get()
          .filter(Boolean);

        const shirtText = $row.find('div.rn_nummer').text().trim();
        const shirtNumber = parseInt(shirtText) || undefined;

        const mvText = $row.find('td.rechts.hauptlink a').text().trim();

        players.push({
          id,
          name,
          image,
          position,
          dateOfBirth: dobText || undefined,
          age: parseInt(ageText) || undefined,
          nationality,
          shirtNumber,
          marketValue: mvText || undefined,
        });
      } catch {
        // Skip un joueur qui plante
      }
    });

    return { players };
  } catch (e: any) {
    console.log(`[TM] Parse error players ${clubId}: ${e.message?.slice(0, 50)}`);
    return null;
  }
}

// ═══════════════════════════════════════
// PLAYER PROFILE — Scrape direct
// ═══════════════════════════════════════

export async function getPlayerProfile(playerId: string): Promise<any> {
  // Essaie l'API d'abord
  const apiResult = await tmApiFetch(`/players/${playerId}/profile`);
  if (apiResult && !apiResult.detail) return apiResult;

  const html = await fetchHtml(`${TM_BASE}/-/profil/spieler/${playerId}`);
  if (!html) return null;

  try {
    const $ = cheerio.load(html);

    const name = $('h1.data-header__headline-wrapper').text().trim()
      || $('h1').first().text().trim();

    const image = $('img.data-header__profile-image').attr('src') || '';

    const mvText = $('a.data-header__market-value-wrapper').text().trim();

    // Info box parsing
    const getInfo = (label: string): string => {
      return $(`span.info-table__content--regular:contains("${label}")`)
        .closest('.info-table__content')
        .find('.info-table__content--bold')
        .text()
        .trim();
    };

    const fullName = getInfo('Name in home country') || getInfo('Full name') || name;
    const dateOfBirth = getInfo('Date of birth');
    const age = parseInt(getInfo('Age') || '0') || undefined;
    const foot = getInfo('Foot');
    const height = getInfo('Height');
    const position = getInfo('Position');
    const contractUntil = getInfo('Contract expires');
    const agent = getInfo('Player agent');

    const nationality = $('span.info-table__content--regular:contains("Citizenship")')
      .closest('.info-table__content')
      .find('img.flaggenrahmen')
      .map((_, img) => $(img).attr('title') || '')
      .get()
      .filter(Boolean);

    // Club info
    const clubEl = $('span.data-header__club a');
    const clubName = clubEl.text().trim();
    const clubLink = clubEl.attr('href') || '';
    const clubIdMatch = clubLink.match(/\/(\d+)$/);
    const clubId = clubIdMatch ? clubIdMatch[1] : '';
    const clubImage = $('img[data-header-club-image]').attr('src')
      || clubEl.find('img').attr('src') || '';

    const shirtText = $('span.data-header__shirt-number').text().trim();
    const shirtNumber = parseInt(shirtText.replace('#', '')) || undefined;

    if (!name) return null;

    return {
      id: playerId,
      name,
      fullName,
      imageUrl: image,
      dateOfBirth,
      age,
      nationality,
      position,
      foot,
      height,
      shirtNumber,
      marketValue: mvText || undefined,
      contractExpiryDate: contractUntil,
      agent,
      club: {
        id: clubId || undefined,
        name: clubName || undefined,
        image: clubImage || undefined,
      },
    };
  } catch (e: any) {
    console.log(`[TM] Parse error player ${playerId}: ${e.message?.slice(0, 50)}`);
    return null;
  }
}

// ═══════════════════════════════════════
// PLAYER TRANSFERS — Scrape direct
// ═══════════════════════════════════════

export async function getPlayerTransfers(playerId: string): Promise<any> {
  // Essaie l'API d'abord
  const apiResult = await tmApiFetch(`/players/${playerId}/transfers`);
  if (apiResult && !apiResult.detail) return apiResult;

  const html = await fetchHtml(`${TM_BASE}/-/transfers/spieler/${playerId}`);
  if (!html) return null;

  try {
    const $ = cheerio.load(html);
    const transfers: any[] = [];

    $('div.box:contains("Transfer history") table.items tbody tr').each((_, row) => {
      try {
        const $row = $(row);

        const season = $row.find('td.zentriert:first-child').text().trim();
        const date = $row.find('td.zentriert:nth-child(2)').text().trim();

        const fromEl = $row.find('td:nth-child(4) a');
        const fromName = fromEl.text().trim();
        const fromLink = fromEl.attr('href') || '';
        const fromId = fromLink.match(/\/(\d+)$/)?.[1];

        const toEl = $row.find('td:nth-child(5) a');
        const toName = toEl.text().trim();
        const toLink = toEl.attr('href') || '';
        const toId = toLink.match(/\/(\d+)$/)?.[1];

        const feeText = $row.find('td.rechts a, td.rechts').last().text().trim();
        const isLoan = feeText.toLowerCase().includes('loan');

        if (fromName || toName) {
          transfers.push({
            season,
            date,
            from: { id: fromId, name: fromName },
            to: { id: toId, name: toName },
            fee: feeText || undefined,
            isLoan,
          });
        }
      } catch {
        // Skip
      }
    });

    return { transfers };
  } catch (e: any) {
    console.log(`[TM] Parse error transfers ${playerId}: ${e.message?.slice(0, 50)}`);
    return { transfers: [] };
  }
}

// ═══════════════════════════════════════
// SEARCH (fallback — moins fiable)
// ═══════════════════════════════════════

export async function searchPlayer(name: string): Promise<any[]> {
  // Essaie l'API d'abord
  if (TM_API) {
    const data = await tmApiFetch(`/players/search/${encodeURIComponent(name)}`);
    if (data?.results?.length > 0) return data.results;
  }

  // Scrape la recherche TM
  const html = await fetchHtml(
    `${TM_BASE}/schnellsuche/ergebnis/schnellsuche?query=${encodeURIComponent(name)}&Spieler_page=0`
  );
  if (!html) return [];

  try {
    const $ = cheerio.load(html);
    const results: any[] = [];

    $('table.items tbody tr').each((_, row) => {
      const $row = $(row);
      const nameEl = $row.find('td.hauptlink a').first();
      const playerName = nameEl.text().trim();
      const link = nameEl.attr('href') || '';
      const id = link.match(/\/(\d+)$/)?.[1];
      const image = $row.find('img.bilderrahmen-fixed').attr('data-src') || '';

      if (playerName && id) {
        results.push({ id, name: playerName, imageUrl: image });
      }
    });

    return results;
  } catch {
    return [];
  }
}

export async function searchClub(name: string): Promise<any[]> {
  // Plus utilisé — on utilise les IDs directs maintenant
  return [];
}

// ═══════════════════════════════════════
// COMPÉTITIONS (gardé pour compatibilité)
// ═══════════════════════════════════════

export async function getCompetitionClubs(competitionId: string): Promise<any> {
  return tmApiFetch(`/competitions/${competitionId}/clubs`);
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