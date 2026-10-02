import { runBot } from '../lib/botcore.js';
// Manual run from the Bot tab (entries from yesterday's finished candle + everything else). The scheduled day runs through
// /api/tick since v0.14.0.
export const GET = (req) => runBot(req, 'am');
