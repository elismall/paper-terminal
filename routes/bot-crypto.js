import { runBot } from '../lib/botcore.js';
// Evening crypto-only run (the heartbeat runs it at 7:00 PM ET since v0.14.0; also callable manually): targets, time exits, standing
// stops, new crypto entries, hold review, daily scoreboard.
export const GET = (req) => runBot(req, 'cx');
