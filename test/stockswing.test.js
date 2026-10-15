// v0.21.0: the stock swing off switch (STOCK_SWING) and its practice picks in the candidate ledger.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setEnv } from './helpers.js';
import { stockSwingOn } from '../lib/core.js';
import { stockEntryMode } from '../lib/botcore.js';
import { ledgerRows, candScore } from '../lib/ledger.js';

test('stock swing buying is off unless STOCK_SWING is exactly "on"', () => {
  for (const v of [undefined, '', 'off', 'true', '1', 'yes']) { setEnv(v === undefined ? {} : { STOCK_SWING: v }); assert.equal(stockSwingOn(), false, `STOCK_SWING=${v}`); }
  for (const v of ['on', 'ON', ' on ']) { setEnv({ STOCK_SWING: v }); assert.equal(stockSwingOn(), true, `STOCK_SWING=${v}`); }
  setEnv();
});

test('a picked stock becomes an order only when swing is on and the run is not a preview', () => {
  setEnv(); assert.equal(stockEntryMode({ dry: false }), 'practice', 'default (off) never orders');
  setEnv({ STOCK_SWING: 'on' }); assert.equal(stockEntryMode({ dry: false }), 'order');
  assert.equal(stockEntryMode({ dry: true }), 'preview', 'a dry run never orders, even when on');
  assert.equal(stockEntryMode({ dry: false, on: false }), 'practice');
  setEnv();
});

test('practice picks are saved and graded apart from real trades', () => {
  const r = (s, score) => ({ s, setup: 'Breakout', score, atr: 2, px: 100 });
  const rows = ledgerRows({ at: '2026-10-15T14:00:00Z', mode: 'morning', P: { stop: 1.5, target: 3, hold: 10 }, minScore: 65, all: [r('AAA', 80), r('BBB', 75), r('CCC', 70)],
    placed: [], practice: [{ s: 'AAA', entry: 101 }], skipped: [{ s: 'BBB', why: 'no live quote' }], price: () => null });
  const by = Object.fromEntries(rows.map(x => [x.s, x]));
  assert.equal(by.AAA.status, 'practice'); assert.equal(by.AAA.px, 101, 'practice entry price kept for grading');
  assert.equal(by.BBB.status, 'skipped'); assert.equal(by.CCC.status, 'no_slot');
  const S = candScore([{ status: 'practice', r: 1 }, { status: 'practice', r: -0.5 }, { status: 'taken', r: 2 }]);
  const row = (l) => S.rows.find(x => x.label === l);
  assert.deepEqual([row('Practice picks (swing buying off)').n, row('Practice picks (swing buying off)').avgR], [2, 0.25]);
  assert.equal(row('Taken').n, 1, 'practice picks never count as taken');
});

test('a symbol picked again while its first practice window is open counts once', () => {
  const S = candScore([
    { d: '2026-10-13', s: 'AAA', status: 'practice', r: 1, exitDay: '2026-10-20' },
    { d: '2026-10-14', s: 'AAA', status: 'practice', r: 1, exitDay: '2026-10-21' },
    { d: '2026-10-21', s: 'AAA', status: 'practice', r: -1, exitDay: '2026-10-28' },
    { d: '2026-10-14', s: 'BBB', status: 'practice', r: 0.5, exitDay: '2026-10-21' },
    { d: '2026-10-14', s: 'AAA', status: 'no_slot', r: 1 }]);
  const row = (l) => S.rows.find(x => x.label === l);
  assert.equal(row('Practice picks (swing buying off)').n, 3, 'AAA 10/13, AAA 10/21 (after the first exit) and BBB');
  assert.equal(row('Qualified, no slot left').n, 1, 'other statuses are left alone');
});
