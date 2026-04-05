import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.NEON_DATABASE_URL!);

async function reset() {
  console.log('Dropping tables...');
  await sql`DROP TABLE IF EXISTS transfers CASCADE`;
  await sql`DROP TABLE IF EXISTS players CASCADE`;
  await sql`DROP TABLE IF EXISTS clubs CASCADE`;
  console.log('✅ All tables dropped. Now run: npx tsx src/index.ts');
}

reset().catch(console.error);