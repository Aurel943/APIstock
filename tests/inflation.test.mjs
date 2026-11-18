import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('inflation : indice INSEE mensuel, interpolation, prolongement et moyennes annuelles connues', () => {
  const a = loadApp({});
  const I = a.get('Inflation'), CPI = a.get('CPI_FR');
  assert.equal(CPI.values.length, I.monthIndex(CPI.end) + 1, 'un indice par mois de start à end');
  near(I.level('1999-01-15'), CPI.values[0]);
  near(I.level('2026-10-15'), CPI.values[CPI.values.length - 1]);
  const mid = I.level('2024-03-01');
  assert.ok(mid > Math.min(I.level('2024-02-15'), I.level('2024-03-15')) - 1e-9 && mid < Math.max(I.level('2024-02-15'), I.level('2024-03-15')) + 1e-9, 'interpolé entre deux mois');
  // moyennes annuelles publiées par l'INSEE : 5,2 % en 2022, 4,9 % en 2023
  const avg = y => { let s = 0; for (let m = 1; m <= 12; m++) s += I.level(`${y}-${String(m).padStart(2, '0')}-15`); return s / 12; };
  near(avg(2022) / avg(2021) - 1, 0.052, 0.0006);
  near(avg(2023) / avg(2022) - 1, 0.049, 0.0006);
  // au-delà du dernier mois publié : au rythme des 12 derniers mois
  near(I.level('2027-10-15') / I.level('2026-10-15') - 1, I.lastYearRate(), 1e-9);
  assert.equal(I.estimated('2026-11-18'), true);
  assert.equal(I.estimated('2026-10-31'), false);
  near(I.real(0.10, 0.05), 1.1 / 1.05 - 1);
});

test('inflation : gains en pouvoir d\'achat, rendement réel de l\'investisseur et années', () => {
  const a = loadApp({});
  const I = a.get('Inflation');
  const flows = [{ date: '2021-01-15', amount: -1000 }, { date: '2023-01-15', amount: -1000 }];
  const g = I.gains(flows, 2600, '2026-10-15');
  near(g.invested, 2000);
  near(g.investedReal, 1000 * I.level('2026-10-15') / I.level('2021-01-15') + 1000 * I.level('2026-10-15') / I.level('2023-01-15'));
  near(g.gain, 600);
  near(g.gainReal, 2600 - g.investedReal);
  near(g.eaten, g.investedReal - 2000);
  assert.ok(g.eaten > 250, 'plus de 12 % d\'inflation sur 2021 → 2026');

  const twr = [['2021-01-15', 100], ['2021-12-31', 120], ['2022-12-30', 108], ['2023-06-30', 120]];
  const S = I.summary({ twr, flows, value: 2600, today: '2026-10-15' });
  near(S.nominal, 0.2);
  near(S.real, 1.2 / (1 + I.between('2021-01-15', '2023-06-30')) - 1);
  assert.ok(S.realXirr < S.xirr && S.xirr > 0, 'le rendement réel est plus bas que le nominal');
  const Y = I.yearly(twr);
  assert.deepEqual(JSON.parse(JSON.stringify(Y.map(y => y.year))), ['2021', '2022', '2023']);
  near(Y[1].nominal, 108 / 120 - 1);
  near(Y[1].real, (108 / 120) / (1 + I.between('2021-12-31', '2022-12-30')) - 1);
  assert.equal(Y[0].partial, true);   // démarre en cours d'année
  assert.equal(Y[1].partial, false);
  assert.equal(Y[2].partial, true);   // s'arrête en juin
  const R = I.realSeries([['2022-01-15', 100], ['2023-01-15', 100]]);
  near(R[1][1], 100);
  near(R[0][1], 100 * I.level('2023-01-15') / I.level('2022-01-15'));
});
