import { json, fail, authorized, hasAlpaca, needKeys } from '../lib/core.js';
import { readHistory, historyMarkdown, dailySnapshot, saveDaily } from '../lib/history.js';
import { VERSION } from '../lib/version.js';
// Daily scoreboard history (Benchmark tab; "Copy as Markdown"). GET = { days, md }. ?save=1 takes today's snapshot now
// (the evening crypto run does this automatically). Passcode required; never cached.
export async function GET(req) {
  if (!authorized(req, { strict: true })) return json({ error: 'locked', message: 'Enter your passcode in Settings to see the history.' }, { status: 401 });
  if (!hasAlpaca()) return needKeys('the daily history');
  try {
    const u = new URL(req.url);
    const h = u.searchParams.get('save') === '1' ? await saveDaily(await dailySnapshot({ version: VERSION })) : (await readHistory()) || { days: [] };
    return json({ days: h.days || [], md: historyMarkdown(h), at: new Date().toISOString() }, { priv: true });
  } catch (e) { return fail(e, 'history'); }
}
export { VERSION };
