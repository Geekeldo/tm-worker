import { neon } from '@neondatabase/serverless';

// ═══════════════════════════════════════
// CONNEXION
// ═══════════════════════════════════════

export const sql = neon(process.env.NEON_DATABASE_URL!);

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
// HELPERS — Nettoyage des valeurs
// ═══════════════════════════════════════

/** Force en string puis nettoie — plus jamais de "value.replace is not a function" */
function cleanString(value: any): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') {
    // Si c'est un objet {value: "€150M"} ou {name: "Jorge Mendes"}
    return String(value.value || value.name || JSON.stringify(value));
  }
  return String(value);
}

/** Extrait un nombre depuis n'importe quel format de valeur marchande */
function parseMarketValue(value: any): number | null {
  if (value === null || value === undefined) return null;
  
  // Déjà un nombre
  if (typeof value === 'number') return value;
  
  // C'est un objet {value: 150000000} ou {value: "€150M"}
  if (typeof value === 'object') {
    value = value.value || value.marketValue || null;
    if (value === null) return null;
    if (typeof value === 'number') return value;
  }
  
  // Convertit en string pour nettoyer
  const str = String(value)
    .replace(/[€$£,\s]/g, '')
    .toLowerCase();
  
  // "150m" → 150000000
  if (str.endsWith('m')) {
    return Math.round(parseFloat(str) * 1_000_000);
  }
  // "500k" → 500000
  if (str.endsWith('k')) {
    return Math.round(parseFloat(str) * 1_000);
  }
  // "150000000"
  const num = parseFloat(str);
  return isNaN(num) ? null : Math.round(num);
}

/** Extrait un nombre de fee de transfert */
function parseTransferFee(fee: any): { display: string | null; number: number | null } {
  if (fee === null || fee === undefined) {
    return { display: null, number: null };
  }
  
  // Objet {value: X, currency: "EUR"} 
  if (typeof fee === 'object') {
    const display = cleanString(fee.value || fee);
    const number = parseMarketValue(fee.value || fee);
    return { display, number };
  }
  
  // String comme "free transfer", "loan", "€85M"
  const str = String(fee);
  const lower = str.toLowerCase();
  
  if (lower.includes('free') || lower.includes('ablösefrei')) {
    return { display: 'Free Transfer', number: 0 };
  }
  if (lower.includes('loan') || lower.includes('leihe')) {
    return { display: 'Loan', number: null };
  }
  if (lower === '-' || lower === '?' || lower === 'n/a') {
    return { display: null, number: null };
  }
  
  return { display: str, number: parseMarketValue(str) };
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
    const tmv = parseMarketValue(club.totalMarketValue);

    await sql`
      INSERT INTO clubs (
        tm_id, name, image_url, league_id, league_name, country,
        stadium_name, stadium_seats, squad_size, average_age,
        total_market_value, coach_name, updated_at
      ) VALUES (
        ${club.id}, ${club.name}, ${club.imageUrl || null},
        ${club.leagueId || null}, ${club.leagueName || null},
        ${club.country || null}, ${club.stadiumName || null},
        ${club.stadiumSeats || null}, ${club.squadSize || null},
        ${club.averageAge || null}, ${tmv},
        ${club.coachName || null}, NOW()
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
        coach_name = COALESCE(EXCLUDED.coach_name, clubs.coach_name),
        updated_at = NOW()
    `;
  } catch (e: any) {
    console.log(`[DB] Club upsert error ${club.name}: ${e.message?.slice(0, 60)}`);
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
}) {
  try {
    const mv = parseMarketValue(player.marketValue);
    const agentStr = cleanString(player.agent);
    const heightStr = cleanString(player.height);
    const positionStr = cleanString(player.position);
    const contractStr = cleanString(player.contractUntil);
    const nationalities = Array.isArray(player.nationality)
      ? player.nationality.filter(Boolean).join(', ')
      : cleanString(player.nationality);

    // ⚡ Si le club du joueur n'est pas dans nos 41 clubs, on le crée à la volée
    if (player.clubId && player.clubName) {
      await sql`
        INSERT INTO clubs (tm_id, name, image_url, updated_at)
        VALUES (${player.clubId}, ${player.clubName}, ${player.clubImage || null}, NOW())
        ON CONFLICT (tm_id) DO NOTHING
      `;
    }

    await sql`
      INSERT INTO players (
        tm_id, name, full_name, image_url, date_of_birth, age,
        nationality, position, shirt_number, club_id, club_name,
        club_image, market_value, market_value_number,
        contract_until, agent, foot, height, updated_at
      ) VALUES (
        ${player.id}, ${player.name}, ${player.fullName || null},
        ${player.imageUrl || null}, ${player.dateOfBirth || null},
        ${player.age || null}, ${nationalities},
        ${positionStr}, ${player.shirtNumber || null},
        ${player.clubId || null}, ${player.clubName || null},
        ${player.clubImage || null},
        ${cleanString(player.marketValue)}, ${mv},
        ${contractStr}, ${agentStr},
        ${cleanString(player.foot)}, ${heightStr}, NOW()
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
        club_id = EXCLUDED.club_id,
        club_name = EXCLUDED.club_name,
        club_image = COALESCE(EXCLUDED.club_image, players.club_image),
        market_value = COALESCE(EXCLUDED.market_value, players.market_value),
        market_value_number = COALESCE(EXCLUDED.market_value_number, players.market_value_number),
        contract_until = COALESCE(EXCLUDED.contract_until, players.contract_until),
        agent = COALESCE(EXCLUDED.agent, players.agent),
        foot = COALESCE(EXCLUDED.foot, players.foot),
        height = COALESCE(EXCLUDED.height, players.height),
        updated_at = NOW()
    `;
  } catch (e: any) {
    console.log(`[DB] Player upsert error ${player.name}: ${e.message?.slice(0, 60)}`);
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

    // ⚡ Assure que les clubs from/to existent (fix FK violation)
    if (transfer.fromClubId && transfer.fromClubName) {
      await sql`
        INSERT INTO clubs (tm_id, name, updated_at)
        VALUES (${transfer.fromClubId}, ${transfer.fromClubName}, NOW())
        ON CONFLICT (tm_id) DO NOTHING
      `;
    }
    if (transfer.toClubId && transfer.toClubName) {
      await sql`
        INSERT INTO clubs (tm_id, name, updated_at)
        VALUES (${transfer.toClubId}, ${transfer.toClubName}, NOW())
        ON CONFLICT (tm_id) DO NOTHING
      `;
    }

    await sql`
      INSERT INTO transfers (
        player_id, player_name,
        from_club_id, from_club_name,
        to_club_id, to_club_name,
        transfer_fee, transfer_fee_number,
        season, transfer_date, is_loan, updated_at
      ) VALUES (
        ${transfer.playerId}, ${transfer.playerName},
        ${transfer.fromClubId || null}, ${transfer.fromClubName || null},
        ${transfer.toClubId || null}, ${transfer.toClubName || null},
        ${feeDisplay}, ${feeNumber},
        ${transfer.season || null}, ${transfer.date || null},
        ${transfer.isLoan || false}, NOW()
      )
      ON CONFLICT (player_id, season, from_club_id, to_club_id) 
      DO UPDATE SET
        transfer_fee = COALESCE(EXCLUDED.transfer_fee, transfers.transfer_fee),
        transfer_fee_number = COALESCE(EXCLUDED.transfer_fee_number, transfers.transfer_fee_number),
        transfer_date = COALESCE(EXCLUDED.transfer_date, transfers.transfer_date),
        is_loan = EXCLUDED.is_loan,
        updated_at = NOW()
    `;
  } catch (e: any) {
    console.log(`[DB] Transfer upsert error: ${e.message?.slice(0, 60)}`);
  }
}