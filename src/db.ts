import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('NEON_DATABASE_URL or DATABASE_URL is required');

export const sql = neon(DATABASE_URL);

export async function testConnection(): Promise<boolean> {
  try {
    await sql`SELECT 1`;
    console.log('[DB] ✅ Neon connected');
    return true;
  } catch (e: any) {
    console.error('[DB] ❌ Connection failed:', e.message);
    return false;
  }
}

// ═══════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════

function cleanString(value: any): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'object') {
    if (value.value !== undefined) return cleanString(value.value);
    if (value.name !== undefined) return cleanString(value.name);
    try { return JSON.stringify(value); } catch { return null; }
  }
  return String(value);
}

function parseMarketValue(value: any): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'object') {
    return parseMarketValue(value.value ?? value.marketValue ?? null);
  }
  const str = String(value).replace(/[€$£,\s]/g, '').trim().toLowerCase();
  if (!str || str === '-' || str === 'n/a' || str.includes('free')) return 0;
  if (str.includes('loan')) return null;
  if (str.endsWith('m')) return Math.round(parseFloat(str) * 1_000_000);
  if (str.endsWith('k') || str.endsWith('tsd')) return Math.round(parseFloat(str) * 1_000);
  const num = parseFloat(str);
  return isNaN(num) ? null : Math.round(num);
}

function parseTransferFee(fee: any): { display: string | null; number: number | null } {
  if (fee === null || fee === undefined) return { display: null, number: null };
  if (typeof fee === 'object' && fee !== null) {
    return { display: cleanString(fee.value ?? fee), number: parseMarketValue(fee.value ?? fee) };
  }
  const str = String(fee).trim();
  const lower = str.toLowerCase();
  if (!str || str === '-' || str === '?') return { display: null, number: null };
  if (lower.includes('free')) return { display: 'Free Transfer', number: 0 };
  if (lower.includes('loan')) return { display: 'Loan', number: null };
  return { display: str, number: parseMarketValue(str) };
}

// ═══════════════════════════════════════
// INIT TABLES
// ═══════════════════════════════════════

export async function initTables() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS clubs (
        tm_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        image_url TEXT,
        league_id TEXT,
        league_name TEXT,
        country TEXT,
        stadium_name TEXT,
        stadium_seats INTEGER,
        squad_size INTEGER,
        average_age REAL,
        total_market_value BIGINT,
        total_market_value_display TEXT,
        coach_name TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS players (
        tm_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        full_name TEXT,
        image_url TEXT,
        date_of_birth TEXT,
        age INTEGER,
        nationality TEXT,
        position TEXT,
        shirt_number INTEGER,
        club_id TEXT,
        club_name TEXT,
        club_image TEXT,
        market_value TEXT,
        market_value_number BIGINT,
        contract_until TEXT,
        agent TEXT,
        foot TEXT,
        height TEXT,
        is_enriched BOOLEAN DEFAULT FALSE,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS transfers (
        id SERIAL PRIMARY KEY,
        player_id TEXT NOT NULL,
        player_name TEXT,
        from_club_id TEXT,
        from_club_name TEXT,
        to_club_id TEXT,
        to_club_name TEXT,
        transfer_fee TEXT,
        transfer_fee_number BIGINT,
        season TEXT,
        transfer_date TEXT,
        is_loan BOOLEAN DEFAULT FALSE,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    // Index unique pour transfers
    await sql`
      DO 
$$
BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_transfers_unique') THEN
          CREATE UNIQUE INDEX idx_transfers_unique
          ON transfers (player_id, COALESCE(season, ''), COALESCE(from_club_id, ''), COALESCE(to_club_id, ''));
        END IF;
      END
$$

    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_players_club ON players (club_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_players_name ON players (name)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_transfers_player ON transfers (player_id)`;

    console.log('[DB] ✅ Tables ready');
  } catch (e: any) {
    console.error('[DB] ❌ Init tables error:', e.message);
    throw e;
  }
}

// ═══════════════════════════════════════
// UPSERT CLUB
// ═══════════════════════════════════════

export async function upsertClub(club: any) {
  try {
    const tmv = parseMarketValue(club.totalMarketValue);
    const tmvDisplay = cleanString(club.totalMarketValue);
    await sql`
      INSERT INTO clubs (tm_id, name, image_url, league_id, league_name, country,
        stadium_name, stadium_seats, squad_size, average_age,
        total_market_value, total_market_value_display, coach_name, updated_at)
      VALUES (${club.id}, ${club.name}, ${club.imageUrl || null},
        ${club.leagueId || null}, ${club.leagueName || null}, ${club.country || null},
        ${club.stadiumName || null}, ${club.stadiumSeats || null},
        ${club.squadSize || null}, ${club.averageAge || null},
        ${tmv}, ${tmvDisplay}, ${club.coachName || null}, NOW())
      ON CONFLICT (tm_id) DO UPDATE SET
        name = EXCLUDED.name,
        image_url = COALESCE(EXCLUDED.image_url, clubs.image_url),
        league_id = COALESCE(EXCLUDED.league_id, clubs.league_id),
        league_name = COALESCE(EXCLUDED.league_name, clubs.league_name),
        country = COALESCE(EXCLUDED.country, clubs.country),
        stadium_name = COALESCE(EXCLUDED.stadium_name, clubs.stadium_name),
        stadium_seats = COALESCE(EXCLUDED.stadium_seats, clubs.stadium_seats),
        squad_size = COALESCE(EXCLUDED.squad_size, clubs.squad_size),
        average_age = COALESCE(EXCLUDED.average_age, clubs.average_age),
        total_market_value = COALESCE(EXCLUDED.total_market_value, clubs.total_market_value),
        total_market_value_display = COALESCE(EXCLUDED.total_market_value_display, clubs.total_market_value_display),
        coach_name = COALESCE(EXCLUDED.coach_name, clubs.coach_name),
        updated_at = NOW()
    `;
  } catch (e: any) {
    console.log(`[DB] Club error ${club.name}: ${e.message?.slice(0, 80)}`);
  }
}

export async function ensureClubExists(id: string, name: string, image?: string) {
  try {
    await sql`
      INSERT INTO clubs (tm_id, name, image_url, updated_at)
      VALUES (${id}, ${name}, ${image || null}, NOW())
      ON CONFLICT (tm_id) DO NOTHING
    `;
  } catch { /* ignore */ }
}

// ═══════════════════════════════════════
// UPSERT PLAYER
// ═══════════════════════════════════════

export async function upsertPlayer(player: any) {
  try {
    const mvNumber = parseMarketValue(player.marketValue);
    const mvDisplay = cleanString(player.marketValue);
    const nationalities = Array.isArray(player.nationality)
      ? player.nationality.filter(Boolean).join(', ')
      : cleanString(player.nationality);

    if (player.clubId && player.clubName) {
      await ensureClubExists(player.clubId, player.clubName, player.clubImage);
    }

    await sql`
      INSERT INTO players (tm_id, name, full_name, image_url, date_of_birth, age,
        nationality, position, shirt_number, club_id, club_name, club_image,
        market_value, market_value_number, contract_until, agent, foot, height,
        is_enriched, updated_at)
      VALUES (${player.id}, ${player.name}, ${cleanString(player.fullName)},
        ${cleanString(player.imageUrl)}, ${cleanString(player.dateOfBirth)},
        ${player.age || null}, ${nationalities}, ${cleanString(player.position)},
        ${player.shirtNumber || null}, ${player.clubId || null},
        ${player.clubName || null}, ${cleanString(player.clubImage)},
        ${mvDisplay}, ${mvNumber}, ${cleanString(player.contractUntil)},
        ${cleanString(player.agent)}, ${cleanString(player.foot)},
        ${cleanString(player.height)}, ${player.isEnriched || false}, NOW())
      ON CONFLICT (tm_id) DO UPDATE SET
        name = EXCLUDED.name,
        full_name = COALESCE(EXCLUDED.full_name, players.full_name),
        image_url = COALESCE(EXCLUDED.image_url, players.image_url),
        date_of_birth = COALESCE(EXCLUDED.date_of_birth, players.date_of_birth),
        age = COALESCE(EXCLUDED.age, players.age),
        nationality = COALESCE(EXCLUDED.nationality, players.nationality),
        position = COALESCE(EXCLUDED.position, players.position),
        shirt_number = COALESCE(EXCLUDED.shirt_number, players.shirt_number),
        club_id = COALESCE(EXCLUDED.club_id, players.club_id),
        club_name = COALESCE(EXCLUDED.club_name, players.club_name),
        club_image = COALESCE(EXCLUDED.club_image, players.club_image),
        market_value = COALESCE(EXCLUDED.market_value, players.market_value),
        market_value_number = COALESCE(EXCLUDED.market_value_number, players.market_value_number),
        contract_until = COALESCE(EXCLUDED.contract_until, players.contract_until),
        agent = COALESCE(EXCLUDED.agent, players.agent),
        foot = COALESCE(EXCLUDED.foot, players.foot),
        height = COALESCE(EXCLUDED.height, players.height),
        is_enriched = CASE WHEN EXCLUDED.is_enriched = true THEN true ELSE players.is_enriched END,
        updated_at = NOW()
    `;
  } catch (e: any) {
    console.log(`[DB] Player error ${player.name}: ${e.message?.slice(0, 80)}`);
  }
}

// ═══════════════════════════════════════
// UPSERT TRANSFER
// ═══════════════════════════════════════

export async function upsertTransfer(transfer: any) {
  try {
    const { display, number } = parseTransferFee(transfer.fee);

    if (transfer.fromClubId && transfer.fromClubName) {
      await ensureClubExists(transfer.fromClubId, transfer.fromClubName);
    }
    if (transfer.toClubId && transfer.toClubName) {
      await ensureClubExists(transfer.toClubId, transfer.toClubName);
    }

    await sql`
      INSERT INTO transfers (player_id, player_name, from_club_id, from_club_name,
        to_club_id, to_club_name, transfer_fee, transfer_fee_number,
        season, transfer_date, is_loan, updated_at)
      VALUES (${transfer.playerId}, ${cleanString(transfer.playerName)},
        ${transfer.fromClubId || null}, ${cleanString(transfer.fromClubName)},
        ${transfer.toClubId || null}, ${cleanString(transfer.toClubName)},
        ${display}, ${number}, ${cleanString(transfer.season)},
        ${cleanString(transfer.date)}, ${transfer.isLoan || false}, NOW())
      ON CONFLICT (player_id, COALESCE(season, ''), COALESCE(from_club_id, ''), COALESCE(to_club_id, ''))
      DO UPDATE SET
        transfer_fee = COALESCE(EXCLUDED.transfer_fee, transfers.transfer_fee),
        transfer_fee_number = COALESCE(EXCLUDED.transfer_fee_number, transfers.transfer_fee_number),
        transfer_date = COALESCE(EXCLUDED.transfer_date, transfers.transfer_date),
        is_loan = EXCLUDED.is_loan,
        updated_at = NOW()
    `;
  } catch (e: any) {
    console.log(`[DB] Transfer error: ${e.message?.slice(0, 80)}`);
  }
}