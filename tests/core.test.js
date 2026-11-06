'use strict';
// Pruebas del núcleo de Plata. Se corren con:  node --test tests/
// Usan solo datos sintéticos; no tocan nada del navegador ni datos reales.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

// generador pseudoaleatorio determinista (las pruebas son reproducibles)
const rng = seed => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const sum = a => a.reduce((s, x) => s + x, 0);
const deepFreeze = o => { Object.values(o).forEach(v => { if (v && typeof v === 'object') deepFreeze(v); }); return Object.freeze(o); };
const counter = () => { let n = 0; return () => 'id' + (++n); };

test('toCents: redondeo simétrico y sin ruido binario', () => {
  assert.equal(C.toCents(1.005), 101);
  assert.equal(C.toCents(-1.005), -101);
  assert.equal(C.toCents(0.1 + 0.2), 30);
  assert.equal(C.toCents(48000 * 1.1), 5280000);   // 52800,00000000001 en coma flotante
  assert.equal(C.toCents('x'), 0);
});

test('splitCents: $ 100 entre 3 conserva el total y el centavo va a la primera persona', () => {
  assert.deepEqual(C.splitCents(10000, 3), [3334, 3333, 3333]);
  assert.deepEqual(C.splitCents(-10000, 3), [-3334, -3333, -3333]);
  assert.deepEqual(C.splitCents(1, 3), [1, 0, 0]);
  assert.deepEqual(C.splitCents(0, 4), [0, 0, 0, 0]);
});

test('splitCents: proporcional por pesos conserva el total (mayor resto primero)', () => {
  const r = C.splitCents(10000, [1, 1, 1]);
  assert.equal(sum(r), 10000);
  const p = C.splitCents(10000, [50, 30, 20]);
  assert.deepEqual(p, [5000, 3000, 2000]);
  assert.equal(sum(C.splitCents(9999, [1, 2, 3])), 9999);
});

test('splitCents: propiedad — siempre suma el total y nadie se aleja más de 1 centavo del reparto ideal', () => {
  const r = rng(1);
  for (let t = 0; t < 5000; t++) {
    const total = Math.round((r() - 0.3) * 20000000), n = 1 + Math.floor(r() * 12), parts = C.splitCents(total, n);
    assert.equal(parts.length, n); assert.equal(sum(parts), total);
    parts.forEach(x => assert.ok(Math.abs(x - total / n) < 1));
  }
});

test('reparto determinista: mismos datos, mismo resultado', () => {
  assert.deepEqual(C.splitCents(12345, [3, 3, 3, 1]), C.splitCents(12345, [3, 3, 3, 1]));
});

test('gasto compartido: $ 100 entre 3 reparte 33,34 / 33,33 / 33,33 y los saldos suman exactamente 0', () => {
  const g = { members: ['Yo', 'Ana', 'Pedro'], expenses: [{ id: 'e', amount: 100, paidBy: 'Yo', split: ['Yo', 'Ana', 'Pedro'] }], payments: [] };
  assert.deepEqual(C.expenseSharesC(g.expenses[0]), { Yo: 3334, Ana: 3333, Pedro: 3333 });
  const bal = C.groupBalancesC(g);
  assert.equal(sum(Object.values(bal)), 0);
  const tr = C.settleC(bal);
  assert.deepEqual(tr.map(t => [t.from, t.to, t.c]), [['Ana', 'Yo', 3333], ['Pedro', 'Yo', 3333]]);   // Yo recupera 66,66 = lo que puso menos su parte
});

test('reparto por consumo con descuentos: el total de los productos se conserva por persona', () => {
  const e = { amount: 1000, paidBy: 'Yo', split: ['Yo', 'Ana', 'Pedro'], items: [
    { name: 'Pizza', amount: 1000.01, split: ['Yo', 'Ana', 'Pedro'] },
    { name: 'Descuento pizza', amount: -100.01, split: ['Yo', 'Ana', 'Pedro'] },
    { name: 'Birra', amount: 450.5, split: ['Ana', 'Pedro'] }] };
  const total = C.expenseTotalC(e);
  assert.equal(total, 135050);
  assert.equal(sum(Object.values(C.expenseSharesC(e))), total);
});

test('grupos: propiedad — con repartos iguales, por monto y por producto, Σ saldos = 0 y settle deja todo a mano con ≤ n−1 pagos', () => {
  const r = rng(7), names = ['Yo', 'Ana', 'Pedro', 'Lu', 'Marta', 'Juan', 'Sofi', 'Teo'];
  for (let t = 0; t < 1500; t++) {
    const n = 2 + Math.floor(r() * 7), members = names.slice(0, n), expenses = [];
    for (let k = 0, ne = 1 + Math.floor(r() * 10); k < ne; k++) {
      const amount = Math.round(r() * 5000000 + 1) / 100, paidBy = members[Math.floor(r() * n)], who = members.filter(() => r() < 0.6), split = who.length ? who : [members[0]];
      const kind = Math.floor(r() * 3);
      if (kind === 0) expenses.push({ id: 'e' + k, amount, paidBy, split });
      else if (kind === 1) { const sh = {}; const parts = C.splitCents(C.toCents(amount), split.map(() => 1 + Math.floor(r() * 5))); split.forEach((m, i) => { sh[m] = parts[i] / 100; }); expenses.push({ id: 'e' + k, amount, paidBy, split, shares: sh, mode: 'exact' }); }
      else { const items = [{ name: 'a', amount, split }, { name: 'd', amount: -Math.round(amount * 10) / 100, split: [split[0]] }]; expenses.push({ id: 'e' + k, amount: C.fromCents(C.expenseTotalC({ items })), paidBy, split, items }); }
    }
    const g = { members, expenses, payments: [] }, bal = C.groupBalancesC(g);
    assert.equal(sum(Object.values(bal)), 0);
    const tr = C.settleC(bal); assert.ok(tr.length <= n - 1);
    const after = { ...bal }; tr.forEach(x => { after[x.from] += x.c; after[x.to] -= x.c; });
    assert.ok(Object.values(after).every(v => v === 0));
    // pagar todo lo sugerido (en pesos, redondeado) no deja deudas fantasma
    const g2 = { ...g, payments: tr.map(x => ({ from: x.from, to: x.to, amount: x.amount })) };
    assert.equal(C.settleC(C.groupBalancesC(g2)).length, 0);
  }
});

test('cuotas: $ 100 en 3 = 33,34 + 33,33 + 33,33 y el total se conserva', () => {
  const a = C.cuotaAmountsC(10000, 3);
  assert.deepEqual(a, [3334, 3333, 3333]); assert.equal(sum(a), 10000);
  const d = { total: 100, cuotas: 3, cuotasPagas: 0 };
  assert.equal(C.debtLeftC(d), 10000);
  assert.equal(C.debtLeftC({ ...d, cuotasPagas: 1 }), 6666);
  assert.equal(C.debtLeftC({ ...d, cuotasPagas: 3 }), 0);
});

test('cuotas viejas (sin total): se respeta lo que estaba guardado, no se reescribe el historial', () => {
  const legacy = { cuota: 33.33, cuotas: 3, cuotasPagas: 1 };
  assert.equal(C.debtTotalC(legacy), 9999);
  assert.equal(C.debtLeftC(legacy), 6666);
});

test('cuotas: vencimientos reales, mes corto, año bisiesto, cambio de año y estado', () => {
  assert.equal(C.addMonthsClamped('2026-01-31', 1), '2026-02-28');
  assert.equal(C.addMonthsClamped('2028-01-31', 1), '2028-02-29');
  assert.equal(C.addMonthsClamped('2026-11-15', 2), '2027-01-15');
  assert.equal(C.addMonthsClamped('2026-01-31', 2), '2026-03-31');
  const d = { total: 300, cuotas: 3, cuotasPagas: 1, firstDue: '2026-09-10' };
  assert.equal(C.cuotaDueDate(d, 2), '2026-11-10');
  assert.equal(C.cuotaStatus(d, 0, '2026-10-20'), 'pagada');
  assert.equal(C.cuotaStatus(d, 1, '2026-10-20'), 'vencida');
  assert.equal(C.cuotaStatus(d, 1, '2026-10-05'), 'pendiente');
  assert.equal(C.cuotaDueDate({ cuotas: 2, cuota: 5 }, 0), null);
});

test('préstamos: 33,33 + 33,33 + 33,34 de una deuda de 100 la dejan en 0 exacto', () => {
  const l = { amount: 100, payments: [{ amount: 33.33 }, { amount: 33.33 }, { amount: 33.34 }] };
  assert.equal(C.loanLeftC(l), 0);
  assert.equal(C.loanLeftC({ amount: 0.3, payments: [{ amount: 0.1 }, { amount: 0.2 }] }), 0);
  assert.equal(C.loanLeftC({ amount: 10, payments: [{ amount: 15 }] }), 0);   // sobrepago no da saldo negativo
});

const base = () => ({ accInit: { Efectivo: 100000, 'Mercado Pago': 50000 }, tx: [], moves: [], adjusts: [], loans: [], debts: [], groups: [] });

test('saldos de cuentas: sin operaciones nuevas, igual que antes (ingresos − gastos + inicial ± traspasos ± ajustes)', () => {
  const S = base();
  S.tx.push({ id: 'a', type: 'ingreso', amount: 500, method: 'Efectivo', date: '2026-10-01' }, { id: 'b', type: 'gasto', amount: 120.5, method: 'Efectivo', date: '2026-10-02' }, { id: 'c', type: 'gasto', amount: 10, date: '2026-10-02' });
  S.moves.push({ id: 'm', from: 'Efectivo', to: 'Mercado Pago', amount: 1000, date: '2026-10-03' });
  S.adjusts.push({ id: 'j', acc: 'Mercado Pago', amount: -25, date: '2026-10-04' });
  assert.equal(C.accBalanceC(S, 'Efectivo'), 10000000 + 50000 - 12050 - 100000);
  assert.equal(C.accBalanceC(S, 'efectivo', '2026-10-01'), 10000000 + 50000);   // al cierre de un día, sin distinguir mayúsculas
  assert.equal(C.accBalanceC(S, 'Mercado Pago'), 5000000 + 100000 - 2500);
  assert.equal(C.totalCashC(S), 15000000 + 50000 - 12050 - 1000 - 2500);   // el gasto sin cuenta cuenta para "tu plata hoy"
});

test('caso de la cena: pago $ 60.000 para tres → sale $ 60.000 de la cuenta, gasto propio $ 20.000, $ 40.000 por recuperar; al cobrar no hay ingreso inventado', () => {
  const S = base();
  S.tx.push({ id: 'cena', type: 'gasto', amount: 20000, paid: 60000, cat: 'Comida', method: 'Mercado Pago', date: '2026-10-10' });
  S.loans.push({ id: 'l1', dir: 'me-deben', person: 'Ana', amount: 20000, link: 'cena', date: '2026-10-10', payments: [] }, { id: 'l2', dir: 'me-deben', person: 'Pedro', amount: 20000, link: 'cena', date: '2026-10-10', payments: [] });
  assert.equal(C.accBalanceC(S, 'Mercado Pago'), 5000000 - 6000000);
  const gastoPropio = sum(S.tx.filter(t => t.type === 'gasto').map(t => C.toCents(t.amount)));
  assert.equal(gastoPropio, 2000000);
  assert.equal(sum(S.loans.map(C.loanLeftC)), 4000000);
  // Ana paga $ 20.000 por transferencia a Mercado Pago
  S.loans[0].payments.push({ id: 'p1', amount: 20000, date: '2026-10-12', acc: 'Mercado Pago' });
  assert.equal(C.accBalanceC(S, 'Mercado Pago'), 5000000 - 6000000 + 2000000);
  assert.equal(sum(S.loans.map(C.loanLeftC)), 2000000);
  assert.equal(S.tx.filter(t => t.type === 'ingreso').length, 0);          // no se inventó un ingreso
  assert.equal(sum(S.tx.filter(t => t.type === 'gasto').map(t => C.toCents(t.amount))), gastoPropio);   // el gasto propio no se borra
});

test('préstamos históricos (sin cuenta) no tocan ningún saldo; con cuenta, sí', () => {
  const S = base();
  S.loans.push({ id: 'h', dir: 'me-deben', person: 'Ana', amount: 5000, date: '2026-01-01', payments: [{ id: 'x', amount: 1000, date: '2026-02-01' }] });
  assert.equal(C.accBalanceC(S, 'Efectivo'), 10000000);
  S.loans.push({ id: 'n', dir: 'me-deben', person: 'Lu', amount: 3000, acc: 'Efectivo', date: '2026-10-01', payments: [] }, { id: 'd', dir: 'debo', person: 'Teo', amount: 2000, acc: 'Efectivo', date: '2026-10-02', payments: [{ id: 'q', amount: 500, acc: 'Efectivo', date: '2026-10-05' }] });
  assert.equal(C.accBalanceC(S, 'Efectivo'), 10000000 - 300000 + 200000 - 50000);
});

test('pagos de grupo con cuenta: cobrar suma, pagar resta; sin cuenta no cambian saldos; el gasto del grupo no mueve la cuenta por sí solo', () => {
  const S = base();
  S.groups.push({ id: 'g', name: 'Viaje', members: ['Yo', 'Ana'], expenses: [{ id: 'e', amount: 1000, paidBy: 'Yo', acc: 'Efectivo', date: '2026-10-01', split: ['Yo', 'Ana'] }], payments: [{ id: 'p', from: 'Ana', to: 'Yo', amount: 500, date: '2026-10-02', acc: 'Efectivo' }, { id: 'q', from: 'Ana', to: 'Yo', amount: 100, date: '2026-10-03' }] });
  assert.equal(C.accBalanceC(S, 'Efectivo'), 10000000 + 50000);   // el gasto del grupo (aunque traiga acc) no mueve la cuenta: eso lo hace el movimiento vinculado
  S.tx.push({ id: 'mi-parte', type: 'gasto', amount: 500, paid: 1000, method: 'Efectivo', date: '2026-10-01', gref: { g: 'g', e: 'e' } });
  assert.equal(C.accBalanceC(S, 'Efectivo'), 10000000 + 50000 - 100000);   // pagaste $ 1.000: salen $ 1.000, tu gasto es $ 500
});

test('cuotas pagadas con cuenta (sin gasto propio) bajan la cuenta una sola vez', () => {
  const S = base();
  S.debts.push({ id: 'd', name: 'Visa', total: 100, cuotas: 3, cuotasPagas: 1, payments: [{ id: 'p', amount: 33.34, date: '2026-10-01', acc: 'Efectivo' }] });
  assert.equal(C.accBalanceC(S, 'Efectivo'), 10000000 - 3334);
  S.debts[0].payments[0].txId = 'tx1';   // si la cuota se anotó como gasto, el flujo viene del movimiento y no se cuenta dos veces
  assert.equal(C.accBalanceC(S, 'Efectivo'), 10000000);
});

test('duplicados: se muestra con qué coincide cada movimiento; monto "cercano" no alcanza', () => {
  const tx = [{ id: 'a', type: 'gasto', amount: 1500, date: '2026-10-10' }, { id: 'b', type: 'gasto', amount: 1500.4, date: '2026-10-10' }, { id: 'c', type: 'ingreso', amount: 1500, date: '2026-10-10' }, { id: 'd', type: 'gasto', amount: 1500, date: '2026-10-20' }];
  const r = C.findDuplicates({ kind: 'gasto', amount: 1500, date: '2026-10-11' }, tx);
  assert.deepEqual(r.map(x => [x.tx.id, x.level]), [['a', 'parecido']]);
  assert.equal(C.findDuplicates({ kind: 'gasto', amount: 1500, date: '2026-10-10' }, tx)[0].level, 'igual');
  assert.equal(C.findDuplicates({ kind: 'gasto', amount: 99, date: '2026-10-10' }, tx).length, 0);
});

test('CSV: separadores, comillas, BOM y errores', () => {
  assert.equal(C.parseCSV('﻿Fecha;Detalle;Importe\n01/10/2026;"Café; con leche";-1.500,50\n').delimiter, ';');
  const ok = C.parseCSV('Fecha,Detalle,Importe\n2026-10-01,"Súper, Coto",-12000.5\n');
  assert.deepEqual(ok.rows[1], ['2026-10-01', 'Súper, Coto', '-12000.5']);
  assert.equal(C.parseCSV('una sola columna\notra').ok, false);
});

test('CSV: números — formato argentino, anglo, paréntesis, signo final; lo ambiguo se marca', () => {
  assert.deepEqual(C.parseNumber('1.234,56'), { value: 1234.56, issue: null });
  assert.deepEqual(C.parseNumber('1,234.56'), { value: 1234.56, issue: null });
  assert.equal(C.parseNumber('(500,00)').value, -500);
  assert.equal(C.parseNumber('12,50-').value, -12.5);
  assert.equal(C.parseNumber('$ 1.234.567,89').value, 1234567.89);
  assert.ok(C.parseNumber('1.234').issue);     // ¿1,234 o 1234?
  assert.ok(C.parseNumber('1,234').issue);
  assert.equal(C.parseNumber('abc').value, null);
  assert.equal(C.parseNumber('').value, null);
});

test('CSV: fechas — válidas, inválidas y ambiguas (día/mes)', () => {
  assert.deepEqual(C.parseDate('2026-10-05'), { value: '2026-10-05', issue: null });
  assert.deepEqual(C.parseDate('25/12/2026'), { value: '2026-12-25', issue: null });
  assert.equal(C.parseDate('05/10/2026').issue, 'fecha ambigua (día/mes)');
  assert.equal(C.parseDate('05/10/2026', 'mdy').value, '2026-05-10');
  assert.equal(C.parseDate('31/02/2026').value, null);
  assert.equal(C.parseDate('ayer').value, null);
  assert.equal(C.parseDate('5/1/26').value, '2026-01-05');
});

test('CSV → movimientos: nuevos vs revisar, débito/crédito, importe cero y filas inutilizables', () => {
  const rows = [['25/12/2026', 'Sueldo', '1.000.000,00'], ['26/12/2026', 'Súper', '-45.000,50'], ['05/01/2027', 'Dudoso', '1.500'], ['xx', 'Roto', '10'], ['27/12/2026', 'Cero', '0']];
  const { items } = C.csvToMovements(rows, { date: 0, desc: 1, amount: 2, debit: -1, credit: -1 });
  assert.equal(items[0].status, 'nuevo'); assert.equal(items[0].kind, 'ingreso');
  assert.equal(items[1].kind, 'gasto'); assert.equal(items[1].amount, 45000.5);
  assert.equal(items[2].status, 'revisar');            // fecha ambigua + importe ambiguo
  assert.equal(items[3].unusable, true);
  assert.ok(items[4].issues.includes('importe cero'));
  const dc = C.csvToMovements([['26/12/2026', 'Retiro', '5.000,00', ''], ['27/12/2026', 'Depósito', '', '8.000,00'], ['28/12/2026', 'Raro', '1,00', '2,00']], { date: 0, desc: 1, amount: -1, debit: 2, credit: 3 }).items;
  assert.deepEqual(dc.map(i => i.kind), ['gasto', 'ingreso', 'gasto']);
  assert.ok(dc[2].issues.includes('tiene débito y crédito a la vez'));
});

const legacyV1 = () => ({
  tx: [{ id: 'a"><img>', type: 'gasto', amount: 100, cat: 'Comida', date: '2026-01-01' }, { id: 'b', type: 'ingreso', amount: 500, cat: 'Sueldo', date: '2026-01-02', method: 'Efectivo' }, { id: 'c', type: 'gasto', amount: 'mal', date: '2026-01-03' }],
  debts: [{ id: 'd1', name: 'Visa', cuotas: 3, cuotasPagas: 1, cuota: 33.33, dueDay: 10 }],
  loans: [{ id: 'l1', dir: 'me-deben', person: ' Ana ', amount: 100, payments: [{ amount: 10, date: '2026-01-05' }] }],
  groups: [{ id: 'g1', name: 'Viaje', members: ['Yo', 5, 'Ana'], expenses: [{ id: 'e1', desc: 'Hotel', amount: 90, paidBy: 'Yo', split: ['Yo', 'Ana'] }, { amount: 'x' }] }]
});
const v55 = () => ({ ...legacyV1(), accInit: { Efectivo: 1000 }, customMethods: ['Galicia'], moves: [{ id: 'm', from: 'Efectivo', to: 'Galicia', amount: 10, date: '2026-01-04' }], me: { alias: 'mi.alias' } });
const v56 = () => ({ ...v55(), adjusts: [{ id: 'j', acc: 'Efectivo', amount: -5, date: '2026-01-06' }] });

test('migración: de cualquier formato anterior al esquema 2, sin perder datos válidos y sin mutar el original', () => {
  for (const make of [legacyV1, v55, v56]) {
    const raw = deepFreeze(make()), { state, from, to, migrated } = C.migrate(raw, counter());
    assert.equal(from, 1); assert.equal(to, C.SCHEMA); assert.equal(migrated, true); assert.equal(state.schemaVersion, 2);
    assert.equal(state.tx.length, 2);                                  // el registro con importe roto se descarta; los válidos quedan
    assert.equal(state.tx[0].id, 'aimg');                              // id inofensivo
    assert.equal(state.debts[0].cuota, 33.33); assert.equal(state.debts[0].total, undefined);   // la cuota guardada no se reescribe
    assert.equal(state.loans[0].person, 'Ana'); assert.ok(state.loans[0].payments[0].id);
    assert.deepEqual(state.groups[0].members, ['Yo', 'Ana']); assert.equal(state.groups[0].expenses.length, 1); assert.deepEqual(state.groups[0].hidden, []);
    assert.deepEqual(Array.isArray(state.adjusts), true); assert.deepEqual(Array.isArray(state.moves), true);
    if (make === v56) assert.equal(state.adjusts[0].amount, -5);
    if (make !== legacyV1) assert.equal(state.me.alias, 'mi.alias');   // campos que no conoce, intactos
  }
});

test('migración: es idempotente y no cambia los números', () => {
  const once = C.migrate(v56(), counter()).state, twice = C.migrate(once, counter());
  assert.equal(twice.migrated, false); assert.equal(twice.from, 2);
  assert.deepEqual(twice.state, once);
  assert.equal(C.totalCashC(twice.state), C.totalCashC(C.normalize(v56(), counter())));
});

test('migración: los saldos no cambian al migrar (mismo resultado antes y después)', () => {
  const raw = v56(), after = C.migrate(raw, counter()).state;
  for (const acc of ['Efectivo', 'Galicia']) assert.equal(C.accBalanceC(after, acc), C.accBalanceC(C.normalize(raw, counter()), acc));
});

test('resumen de un backup antes de restaurarlo', () => {
  const s = C.summarize({ ...v56(), _meta: { at: '2026-10-01T10:00:00Z' }, schemaVersion: 2 });
  assert.equal(s.movements, 3); assert.equal(s.loans, 1); assert.equal(s.groups, 1); assert.equal(s.from, '2026-01-01'); assert.equal(s.to, '2026-01-03'); assert.equal(s.version, 2); assert.equal(s.exportedAt, '2026-10-01T10:00:00Z');
  assert.equal(C.summarize({}).movements, 0);
});

test('guardado: si falla el principal usa la reserva; si fallan los dos, informa el error (no finge éxito)', async () => {
  const calls = [];
  assert.equal(await C.persist(async () => calls.push('p'), async () => calls.push('r')), 'principal');
  assert.equal(await C.persist(async () => { throw new Error('idb'); }, async () => calls.push('r2')), 'reserva');
  await assert.rejects(() => C.persist(async () => { throw new Error('idb'); }, async () => { throw new Error('ls'); }), e => e.message.includes('No se pudo guardar') && e.causes.length === 2);
  assert.deepEqual(calls, ['p', 'r2']);
});

test('lectura: gana el guardado más nuevo entre el almacén principal y la reserva', () => {
  const a = { savedAt: '2026-10-01T10:00:00Z', n: 1 }, b = { savedAt: '2026-10-02T10:00:00Z', n: 2 };
  assert.equal(C.chooseNewest(a, b).n, 2); assert.equal(C.chooseNewest(b, a).n, 2);
  assert.equal(C.chooseNewest(null, a).n, 1); assert.equal(C.chooseNewest(a, null).n, 1); assert.equal(C.chooseNewest(null, null), null);
});
