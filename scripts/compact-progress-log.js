// Compacta o log append-only de `event_progress`, evento por evento, pro
// conjunto mínimo de linhas que reproduz EXATAMENTE o mesmo estado atual —
// nunca apaga nem altera nada que ainda esteja visível no app (ver
// lib/pure.js#computeMinimalProgressRows e os testes que garantem essa
// invariante). Não é automático/agendado de propósito: a tabela ainda é
// pequena o bastante pra isso não ser um problema real hoje — é só um script
// pra rodar de vez em quando, manualmente, quando fizer sentido.
//
// Uso:
//   node scripts/compact-progress-log.js           (dry run — só mostra o que faria)
//   node scripts/compact-progress-log.js --apply    (aplica de verdade)
//
// Precisa de DATABASE_URL configurada (mesma variável usada pelos testes de
// RLS — veja tests/README.md pra saber como pegar essa connection string).
import 'dotenv/config';
import pg from 'pg';
import { computeMinimalProgressRows, foldProgress } from '../lib/pure.js';

const { Pool } = pg;
const apply = process.argv.includes('--apply');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL não configurada — veja tests/README.md.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString, max: 5 });
  const client = await pool.connect();

  try {
    const { rows: eventIds } = await client.query('select distinct event_id from event_progress order by event_id');
    console.log(`${eventIds.length} evento(s) com log de progresso.`);

    let eventsCompacted = 0;
    let rowsRemoved = 0;

    for (const { event_id: eventId } of eventIds) {
      const { rows } = await client.query(
        'select action, payload from event_progress where event_id = $1 order by created_at asc',
        [eventId]
      );
      const minimalRows = computeMinimalProgressRows(rows);

      if (minimalRows.length >= rows.length) continue; // nada a ganhar compactando esse

      // confere a invariante de novo aqui, em cima do dado real — nunca troca
      // linha por linha sem ter certeza de que o estado final bate
      const before = foldProgress(rows);
      const after = foldProgress(minimalRows);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        console.error(`  ✗ ${eventId}: estado não bateu depois de compactar — pulando esse evento, nada foi alterado.`);
        continue;
      }

      console.log(`  ${apply ? '✓' : '(dry run)'} ${eventId}: ${rows.length} → ${minimalRows.length} linhas`);
      eventsCompacted++;
      rowsRemoved += rows.length - minimalRows.length;

      if (apply) {
        await client.query('begin');
        try {
          await client.query('delete from event_progress where event_id = $1', [eventId]);
          for (const row of minimalRows) {
            await client.query(
              'insert into event_progress (event_id, action, payload) values ($1, $2, $3)',
              [eventId, row.action, row.payload]
            );
          }
          await client.query('commit');
        } catch (err) {
          await client.query('rollback');
          throw err;
        }
      }
    }

    console.log(
      apply
        ? `\nPronto: ${eventsCompacted} evento(s) compactado(s), ${rowsRemoved} linha(s) removida(s).`
        : `\nDry run: ${eventsCompacted} evento(s) seriam compactados, ${rowsRemoved} linha(s) removida(s). Rode com --apply pra aplicar de verdade.`
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
