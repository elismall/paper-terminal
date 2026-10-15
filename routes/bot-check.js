import { runBot } from '../lib/botcore.js';
// Crypto check, crypto only, light. The heartbeat runs it on every tick since v0.14.0 (every 15 minutes on the free setup; hourly before); manual from the Bot tab.
export const GET = (req) => runBot(req, 'chk');
