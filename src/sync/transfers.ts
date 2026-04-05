import { sql } from '../db';

export async function getTransferStats(): Promise<{
  total: number;
  withFee: number;
  loans: number;
}> {
  const result = await sql`
    SELECT
      COUNT(*) as total,
      COUNT(CASE WHEN transfer_fee_number > 0 THEN 1 END) as with_fee,
      COUNT(CASE WHEN is_loan = true THEN 1 END) as loans
    FROM transfers
  `;

  return {
    total: Number(result[0]?.total || 0),
    withFee: Number(result[0]?.with_fee || 0),
    loans: Number(result[0]?.loans || 0),
  };
}

export async function getTopTransfers(limit = 10) {
  return sql`
    SELECT * FROM transfers
    WHERE transfer_fee_number > 0
    ORDER BY transfer_fee_number DESC
    LIMIT ${limit}
  `;
}