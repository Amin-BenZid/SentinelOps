// Transactional-outbox consumer. The agent (or the API, for manual resolves)
// writes an outbox row in the SAME transaction as the alert change, so a
// notification can never be lost or created for a change that rolled back.
// This worker delivers pending rows and retries failures with backoff.
import db from '../db.js';
import { notifier } from './notifier.js';

const MAX_ATTEMPTS = Number(process.env.NOTIFY_MAX_ATTEMPTS || 5);
const BASE_BACKOFF_MS = 15_000;

let running = false;

export async function processOutboxOnce(now = Date.now(), channel = notifier) {
  if (running) return { processed: 0 };
  running = true;
  let processed = 0;
  try {
    const rows = db.prepare(`
      SELECT o.id AS outbox_id, o.event, o.attempts, a.*
      FROM notifications_outbox o JOIN alerts a ON a.id = o.alert_id
      WHERE o.status = 'pending' AND o.next_attempt_at <= ?
      ORDER BY o.id LIMIT 20
    `).all(now);

    for (const row of rows) {
      try {
        const status = await channel.dispatch(row, row.event);
        db.prepare(`UPDATE notifications_outbox SET status = ?, attempts = attempts + 1, processed_at = ?, last_error = NULL
                    WHERE id = ?`).run(status, Date.now(), row.outbox_id);
        console.log(`[outbox] #${row.outbox_id} ${row.event} ${row.rule_name}@${row.entity_id} -> ${status}`);
      } catch (err) {
        const attempts = row.attempts + 1;
        const giveUp = attempts >= MAX_ATTEMPTS;
        db.prepare(`UPDATE notifications_outbox SET status = ?, attempts = ?, last_error = ?, next_attempt_at = ?,
                    processed_at = ? WHERE id = ?`)
          .run(giveUp ? 'failed' : 'pending', attempts, String(err.message).slice(0, 500),
               Date.now() + BASE_BACKOFF_MS * 2 ** (attempts - 1), giveUp ? Date.now() : null, row.outbox_id);
        console.error(`[outbox] #${row.outbox_id} attempt ${attempts} failed${giveUp ? ' (giving up)' : ''}: ${err.message}`);
      }
      processed++;
    }
  } finally {
    running = false;
  }
  return { processed };
}

export function startOutboxWorker(intervalMs = 3000) {
  const t = setInterval(() => { processOutboxOnce().catch((e) => console.error('[outbox]', e.message)); }, intervalMs);
  t.unref();
  return t;
}
