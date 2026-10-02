import { runBot } from '../lib/botcore.js';
// Manual/legacy afternoon run (not scheduled since v0.14.0: the 5-minute heartbeat /api/tick runs the day): same as a morning run.
export const GET = (req) => runBot(req, 'pm');
