import { json, fail, env, authorized, hasAlpaca, needKeys, cronOk as isCron } from '../lib/core.js';
import { histFill } from '../lib/dcalab.js';
import { histStatus } from '../lib/hist.js';
// v0.12.2: stored crypto price history (lib/hist.js). GET = how complete each history file is. The cron (several times a day) or
// ?run=1 (passcode) downloads older history for up to ~4 minutes; it does nothing once everything is downloaded.
export async function GET(req) {
  const u = new URL(req.url).searchParams, cronOk = isCron(req);
  if (!cronOk && !authorized(req, { strict: true })) return json({ error: 'locked', message: 'Enter your passcode in Settings.' }, { status: 401 });
  if (!hasAlpaca()) return needKeys('the price history download');
  if (!env('BLOB_READ_WRITE_TOKEN')) return json({ error: 'no_store', message: 'The price history needs the Blob store (BLOB_READ_WRITE_TOKEN).' });
  try {
    const run = cronOk || u.get('run') === '1';
    return json(run ? await histFill() : { status: await histStatus() }, { priv: true });
  } catch (e) { return fail(e, 'hist'); }
}
