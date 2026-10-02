import { runBot } from '../lib/botcore.js';
// Crypto check, crypto only, light. The heartbeat runs it every 5 minutes since v0.14.0 (hourly before); manual from the Bot tab.
export const GET = (req) => runBot(req, 'chk');
