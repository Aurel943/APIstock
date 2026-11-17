import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const plain = x => JSON.parse(JSON.stringify(x));

test('aujourd\'hui : lignes qui ont le plus pesé et phrase d\'explication', () => {
  const a = loadApp({});
  const T = a.get('Today');
  const rows = [
    { key: 'A', dayBase: 15.7, quote: { percentChange: 0.45 } },
    { key: 'B', dayBase: -3.53, quote: { percentChange: -0.26 } },
    { key: 'C', dayBase: 14.02, quote: { percentChange: 0.41 } },
    { key: 'D', dayBase: NaN },
    { key: 'E', dayBase: 0.001 },
  ];
  const d = plain(T.drivers(rows));
  assert.deepEqual(d.map(x => x.key), ['A', 'C', 'B']);
  const s = T.sentence({ day: 26.19, dayPct: 0.32 }, d, k => k, 'EUR');
  assert.match(s, /^Hausse portée par A \(\+15,70\s€\) et C \(\+14,02\s€\), freinée par B \(-3,53\s€\)\.$/);
  assert.match(T.sentence({ day: -40, dayPct: -0.8 }, [{ key: 'A', day: -42 }, { key: 'B', day: 2 }], k => k, 'EUR'), /^Baisse due surtout à A .*, amortie par B/);
  assert.match(T.sentence({ day: 0.5, dayPct: 0.01 }, d, k => k, 'EUR'), /Journée calme/);
  assert.equal(T.sentence({ day: NaN, dayPct: NaN }, [], k => k, 'EUR'), '');
});

test('aujourd\'hui : événements d\'aujourd\'hui et de demain seulement', () => {
  const a = loadApp({});
  const T = a.get('Today');
  const ev = plain(T.upcoming([{ date: '2026-11-17', kind: 'earn', title: 'NVIDIA' }, { date: '2026-11-18', kind: 'eco', title: 'X' }, { date: '2026-11-19', kind: 'div', title: 'Y' }], '2026-11-17'));
  assert.deepEqual(ev.map(e => [e.when, e.title]), [['Aujourd\'hui', 'NVIDIA'], ['Demain', 'X']]);
});
