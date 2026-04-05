import { neon } from '@neondatabase/serverless';

// ═══════════════════════════════════════
// CONNEXION NEON
// ═══════════════════════════════════════

const DATABASE_URL = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('NEON_DATABASE_URL or DATABASE_URL is required');
}

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
// HELPERS — Plus jamais de "value.replace is not a function"
// ═══════════════════════════════════════

/** Transforme n'importe quoi en string safe (ou null) */
function cleanString(value: any): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return value.trim() || null;
  
  // Objet: essaie d'extraire .value, .name, ou stringify
  if (typeof value === 'object') {
    if (value.value !== undefined) return cleanString(value.value);
    if (value.name !== undefined) return cleanString(value.name);
    try { return JSON.stringify(value); } catch { return null; }
  }
  
  return String(value);
}

/** Transforme n'importe quel format de market value en nombre */
function parseMarketValue(value: any): number | null {
  if (value === null || value === undefined) return null;

  // Déjà un nombre
  if (typeof value === 'number') return value;

  // Objet: {value: 150000000} ou {value: "€150M", currency: "EUR"}
  if (typeof value === 'object') {
    const inner = value.value ?? value.marketValue ?? value.amount ?? null;
    if (inner === null) return null;
    return parseMarketValue(inner); // Récursif
  }

  // String: "€150M", "€500K", "150000000", "free transfer"
  const str = String(value)
    .replace(/[€$£,\s]/g, '')
    .trim()
    .toLowerCase();

  if (!str || str === '-' || str === 'n/a' || str.includes('free')) return 0;
  if (str.includes('loan') || str.includes('leihe')) return null;

  // "150m" → 150_000_000
  if (str.endsWith('m')) {
    const num = parseFloat(str.replace('m', ''));
    return isNaN(num) ? null : Math.round(num * 1_000_000);
  }

  // "500k" ou "500tsd" → 500_000
  if (str.endsWith('k') || str.endsWith('tsd')) {
    const num = parseFloat(str.replace(/[ktsd.]/g, ''));
    return isNaN(num) ? null : Math.round(num * 1_000);
  }

  // "150000000" → nombre direct
  const num = parseFloat(str);
  return isNaN(num) ? null : Math.round(num);
}

/** Parse un fee de transfert → {display, number} */
function parseTransferFee(fee: any): { display: string | null; number: number | null } {
  if (fee === null || fee === undefined) {
    return { display: null, number: null };
  }

  // Objet: {value: "€85M", currency: "EUR"}
  if (typeof fee === 'object' && fee !== null) {
    const display = cleanString(fee.value ?? fee);
    const number = parseMarketValue(fee.value ?? fee);
    return { display, number };
  }

  const str = String(fee).trim();
  const lower = str.toLowerCase();

  // Cas spéciaux
  if (!str || str === '-' || str === '?') {
    return { display: null, number: null };
  }
  if (lower.includes('free') || lower.includes('ablösefrei') || lower.includes('ablöse')) {
    return { display: 'Free Transfer', number: 0 };
  }
  if (lower.includes('loan') || lower.includes('leihe')) {
    return { display: 'Loan', number: null };
  }
  if (lower === 'draft' || lower.includes('end of') || lower.includes('youth')) {
    return { display: str, number: 0 };
  }

  return { display: str, number: parseMarketValue(str) };
}

// ═══════════════════════════════════════
// INIT TABLES — Crée les tables si elles n'existent pas
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

    // Index unique pour éviter les doublons de transferts
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_transfers_unique
      ON transfers (player_id, COALESCE(season, ''), COALESCE(from_club_id, ''), COALESCE(to_club_id, ''))
    `;

    // Index pour les recherches rapides
    await sql`CREATE INDEX IF NOT EXISTS idx_players_club ON players (club_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_players_name ON players (name)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_transfers_player ON transfers (player_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_transfers_fee ON transfers (transfer_fee_number DESC)`;

    console.log('[DB] ✅ Tables ready');
  } catch (e: any) {
    console.error('[DB] ❌ Init tables error:', e.message);
    throw e;
  }
}

// ═══════════════════════════════════════
// UPSERT CLUB
// ═══════════════════════════════════════

export async function upsertClub(club: {
  id: string;
  name: string;
  imageUrl?: string;
  leagueId?: string;
  leagueName?: string;
  country?: string;
  stadiumName?: string;
  stadiumSeats?: number;
  squadSize?: number;
  averageAge?: number;
  totalMarketValue?: any;
  coachName?: string;
}) {
  try {
    const tmvNumber = parseMarketValue(club.totalMarketValue);
    const tmvDisplay = cleanString(club.totalMarketValue);

    await sql`
      INSERT INTO clubs (
        tm_id, name, image_url, league_id, league_name, country,
        stadium_name, stadium_seats, squad_size, average_age,
        total_market_value, total_market_value_display, coach_name, updated_at
      ) VALUES (
        ${club.id},
        ${club.name},
        ${club.imageUrl || null},
        ${club.leagueId || null},
        ${club.leagueName || null},
        ${club.country || null},
        ${club.stadiumName || null},
        ${club.stadiumSeats || null},
        ${club.squadSize || null},
        ${club.averageAge || null},
        ${tmvNumber},
        ${tmvDisplay},
        ${club.coachName || null},
        NOW()
      )
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
    console.log(`[DB] Club upsert error ${club.name}: ${e.message?.slice(0, 80)}`);
  }
}

/** Mini upsert — juste pour créer un club référencé dans un transfert */
export async function ensureClubExists(clubId: string, clubName: string, clubImage?: string) {
  try {
    await sql`
      INSERT INTO clubs (tm_id, name, image_url, updated_at)
      VALUES (${clubId}, ${clubName}, ${clubImage || null}, NOW())
      ON CONFLICT (tm_id) DO NOTHING
    `;
  } catch (e: any) {
    // Silencieux — c'est pas grave si ça fail
  }
}

// ═══════════════════════════════════════
// UPSERT PLAYER
// ═══════════════════════════════════════

export async function upsertPlayer(player: {
  id: string;
  name: string;
  fullName?: string;
  imageUrl?: string;
  dateOfBirth?: string;
  age?: number;
  nationality?: string[];
  position?: string;
  shirtNumber?: number;
  clubId?: string;
  clubName?: string;
  clubImage?: string;
  marketValue?: any;
  contractUntil?: string;
  agent?: any;
  foot?: string;
  height?: any;
  isEnriched?: boolean;
}) {
  try {
    const mvNumber = parseMarketValue(player.marketValue);
    const mvDisplay = cleanString(player.marketValue);
    const agentStr = cleanString(player.agent);
    const heightStr = cleanString(player.height);
    const positionStr = cleanString(player.position);
    const contractStr = cleanString(player.contractUntil);
    const footStr = cleanString(player.foot);
    const dobStr = cleanString(player.dateOfBirth);
    const fullNameStr = cleanString(player.fullName);
    const imageStr = cleanString(player.imageUrl);
    const clubImageStr = cleanString(player.clubImage);

    const nationalities = Array.isArray(player.nationality)
      ? player.nationality.filter(Boolean).join(', ')
      : cleanString(player.nationality);

    // Auto-create le club s'il n'existe pas
    if (player.clubId && player.clubName) {
      await ensureClubExists(player.clubId, player.clubName, player.clubImage);
    }

    await sql`
      INSERT INTO players (
        tm_id, name, full_name, image_url, date_of_birth, age,
        nationality, position, shirt_number, club_id, club_name,
        club_image, market_value, market_value_number,
        contract_until, agent, foot, height, is_enriched, updated_at
      ) VALUES (
        ${player.id},
        ${player.name},
        ${fullNameStr},
        ${imageStr},
        ${dobStr},
        ${player.age || null},
        ${nationalities},
        ${positionStr},
        ${player.shirtNumber || null},
        ${player.clubId || null},
        ${player.clubName || null},
        ${clubImageStr},
        ${mvDisplay},
        ${mvNumber},
        ${contractStr},
        ${agentStr},
        ${footStr},
        ${heightStr},
        ${player.isEnriched || false},
        NOW()
      )
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
        is_enriched = CASE 
          WHEN EXCLUDED.is_enriched = true THEN true 
          ELSE players.is_enriched 
        END,
        updated_at = NOW()
    `;
  } catch (e: any) {
    console.log(`[DB] Player upsert error ${player.name}: ${e.message?.slice(0, 80)}`);
  }
}

// ═══════════════════════════════════════
// UPSERT TRANSFER
// ═══════════════════════════════════════

export async function upsertTransfer(transfer: {
  playerId: string;
  playerName: string;
  fromClubId?: string;
  fromClubName?: string;
  toClubId?: string;
  toClubName?: string;
  fee?: any;
  season?: string;
  date?: string;
  isLoan?: boolean;
}) {
  try {
    const { display: feeDisplay, number: feeNumber } = parseTransferFee(transfer.fee);

    // Auto-create les clubs from/to s'ils n'existent pas (fix FK)
    if (transfer.fromClubId && transfer.fromClubName) {
      await ensureClubExists(transfer.fromClubId, transfer.fromClubName);
    }
    if (transfer.toClubId && transfer.toClubName) {
      await ensureClubExists(transfer.toClubId, transfer.toClubName);
    }

    const seasonStr = cleanString(transfer.season);
    const dateStr = cleanString(transfer.date);
    const playerNameStr = cleanString(transfer.playerName);
    const fromNameStr = cleanString(transfer.fromClubName);
    const toNameStr = cleanString(transfer.toClubName);

    await sql`
      INSERT INTO transfers (
        player_id, player_name,
        from_club_id, from_club_name,
        to_club_id, to_club_name,
        transfer_fee, transfer_fee_number,
        season, transfer_date, is_loan, updated_at
      ) VALUES (
        ${transfer.playerId},
        ${playerNameStr},
        ${transfer.fromClubId || null},
        ${fromNameStr},
        ${transfer.toClubId || null},
        ${toNameStr},
        ${feeDisplay},
        ${feeNumber},
        ${seasonStr},
        ${dateStr},
        ${transfer.isLoan || false},
        NOW()
      )
      ON CONFLICT (player_id, COALESCE(season, ''), COALESCE(from_club_id, ''), COALESCE(to_club_id, ''))
      DO UPDATE SET
        player_name = COALESCE(EXCLUDED.player_name, transfers.player_name),
        from_club_name = COALESCE(EXCLUDED.from_club_name, transfers.from_club_name),
        to_club_name = COALESCE(EXCLUDED.to_club_name, transfers.to_club_name),
        transfer_fee = COALESCE(EXCLUDED.transfer_fee, transfers.transfer_fee),
        transfer_fee_number = COALESCE(EXCLUDED.transfer_fee_number, transfers.transfer_fee_number),
        transfer_date = COALESCE(EXCLUDED.transfer_date, transfers.transfer_date),
        is_loan = EXCLUDED.is_loan,
        updated_at = NOW()
    `;
  } catch (e: any) {
    console.log(`[DB] Transfer upsert error: ${e.message?.slice(0, 80)}`);
  }
}