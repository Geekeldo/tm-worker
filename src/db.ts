import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.NEON_DATABASE_URL!;

if (!DATABASE_URL) {
  throw new Error('NEON_DATABASE_URL is required');
}

export const sql = neon(DATABASE_URL);

// ═══════════════════════════════════════
// Parser "€180m" → 180000000
// ═══════════════════════════════════════

export function parseMarketValue(value: string | null | undefined): number {
  if (!value) return 0;
  const clean = value.replace(/[^0-9.kmb]/gi, '').toLowerCase();
  let num = parseFloat(clean) || 0;
  if (value.toLowerCase().includes('bn') || value.toLowerCase().includes('b')) num *= 1000000000;
  else if (value.toLowerCase().includes('m')) num *= 1000000;
  else if (value.toLowerCase().includes('k') || value.toLowerCase().includes('th')) num *= 1000;
  return Math.round(num);
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
  marketValue?: string;
  contractUntil?: string;
  agent?: string;
  foot?: string;
  height?: string;
}) {
  try {
    await sql`
      INSERT INTO players (
        id, name, full_name, image_url, date_of_birth, age,
        nationality, position, shirt_number, current_club_id,
        current_club_name, current_club_image, market_value,
        market_value_number, contract_until, agent, foot, height, updated_at
      ) VALUES (
        ${player.id}, ${player.name}, ${player.fullName || player.name},
        ${player.imageUrl || null}, ${player.dateOfBirth || null}, ${player.age || null},
        ${player.nationality || []}, ${player.position || null}, ${player.shirtNumber || null},
        ${player.clubId || null}, ${player.clubName || null}, ${player.clubImage || null},
        ${player.marketValue || null}, ${parseMarketValue(player.marketValue)},
        ${player.contractUntil || null}, ${player.agent || null},
        ${player.foot || null}, ${player.height || null},
        ${new Date().toISOString()}
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        full_name = EXCLUDED.full_name,
        image_url = COALESCE(EXCLUDED.image_url, players.image_url),
        age = COALESCE(EXCLUDED.age, players.age),
        current_club_id = COALESCE(EXCLUDED.current_club_id, players.current_club_id),
        current_club_name = COALESCE(EXCLUDED.current_club_name, players.current_club_name),
        current_club_image = COALESCE(EXCLUDED.current_club_image, players.current_club_image),
        market_value = COALESCE(EXCLUDED.market_value, players.market_value),
        market_value_number = CASE
          WHEN EXCLUDED.market_value IS NOT NULL THEN EXCLUDED.market_value_number
          ELSE players.market_value_number
        END,
        contract_until = COALESCE(EXCLUDED.contract_until, players.contract_until),
        updated_at = NOW()
    `;
  } catch (e: any) {
    console.log(`[DB] Player upsert error ${player.name}: ${e.message?.slice(0, 60)}`);
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
  totalMarketValue?: string;
  coachName?: string;
}) {
  try {
    await sql`
      INSERT INTO clubs (
        id, name, image_url, league_id, league_name, country,
        stadium_name, stadium_seats, squad_size, average_age,
        total_market_value, coach_name, updated_at
      ) VALUES (
        ${club.id}, ${club.name}, ${club.imageUrl || null},
        ${club.leagueId || null}, ${club.leagueName || null}, ${club.country || null},
        ${club.stadiumName || null}, ${club.stadiumSeats || null},
        ${club.squadSize || null}, ${club.averageAge || null},
        ${club.totalMarketValue || null}, ${club.coachName || null},
        ${new Date().toISOString()}
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        image_url = COALESCE(EXCLUDED.image_url, clubs.image_url),
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
// UPSERT TRANSFER
// ═══════════════════════════════════════

export async function upsertTransfer(transfer: {
  playerId?: string;
  playerName: string;
  fromClubId?: string;
  fromClubName?: string;
  toClubId?: string;
  toClubName?: string;
  fee?: string;
  season?: string;
  date?: string;
  isLoan?: boolean;
}) {
  try {
    await sql`
      INSERT INTO transfers (
        player_id, player_name, from_club_id, from_club_name,
        to_club_id, to_club_name, transfer_fee, transfer_fee_number,
        season, date, is_loan
      ) VALUES (
        ${transfer.playerId || null}, ${transfer.playerName},
        ${transfer.fromClubId || null}, ${transfer.fromClubName || null},
        ${transfer.toClubId || null}, ${transfer.toClubName || null},
        ${transfer.fee || null}, ${parseMarketValue(transfer.fee)},
        ${transfer.season || null}, ${transfer.date || null},
        ${transfer.isLoan || false}
      )
      ON CONFLICT DO NOTHING
    `;
  } catch (e: any) {
    console.log(`[DB] Transfer upsert error: ${e.message?.slice(0, 60)}`);
  }
}

// ═══════════════════════════════════════
// TEST CONNECTION
// ═══════════════════════════════════════

export async function testConnection(): Promise<boolean> {
  try {
    const result = await sql`SELECT 1 as ok`;
    console.log(`[DB] ✅ Neon connected`);
    return true;
  } catch (e: any) {
    console.log(`[DB] ❌ Connection failed: ${e.message?.slice(0, 60)}`);
    return false;
  }
}