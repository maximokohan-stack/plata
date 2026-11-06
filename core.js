'use strict';
/* Núcleo de Plata: toda la aritmética de plata, sin pantalla ni almacenamiento. Se carga en el navegador (window.Core)
   y en las pruebas de Node (require). Las cuentas se hacen en CENTAVOS ENTEROS: con decimales de coma flotante,
   100 ÷ 3 o 48.000 + 10 % dan restos que terminan en cobros de más o en un centavo que no cierra.

   Reglas adoptadas (se documentan acá porque son decisiones, no detalles):
   - Un importe se guarda en pesos con a lo sumo 2 decimales; internamente se opera en centavos.
   - Al repartir, el total se conserva: los centavos sobrantes se asignan de a uno, empezando por quien figura primero
     en la lista (o por el que tiene mayor resto, si el reparto es proporcional). Es determinista: mismo dato, mismo reparto.
   - Cuotas: las primeras cuotas llevan el centavo extra ($ 100 en 3 = 33,34 + 33,33 + 33,33).
   - Plata que se mueve (cuentas) ≠ gasto propio ≠ plata por recuperar: ver cashFlows(). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SCHEMA = 2;   // 1 = versiones hasta la 56 (sin número); 2 = agrega schemaVersion y los campos de operaciones con cuentas

  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  // $ → centavos, redondeo "mitad hacia afuera" simétrico (1,005 → 1,01 y −1,005 → −1,01) con margen contra el ruido binario
  const toCents = x => { const n = Number(x); if (!isFinite(n)) return 0; return Math.sign(n) * Math.round(Math.abs(n) * 100 + 1e-7); };
  const fromCents = c => c / 100;
  const round2 = x => fromCents(toCents(x));
  const sumC = a => a.reduce((s, x) => s + x, 0);

  // ---------- reparto que conserva el total ----------
  // splitCents(total, n | [pesos]) → array de centavos que suma exactamente `total`. Con pesos, es proporcional (mayor resto primero).
  function splitCents(total, parts) {
    const w = Array.isArray(parts) ? parts.map(Number) : Array.from({ length: parts }, () => 1);
    if (!w.length) return [];
    const sign = total < 0 ? -1 : 1, T = Math.abs(total), W = w.reduce((s, x) => s + x, 0);
    if (!(W > 0)) return w.map((_, i) => (i === 0 ? total : 0));
    const base = w.map(x => Math.floor(T * x / W + 1e-9)), rem = T - sumC(base);
    const frac = w.map((x, i) => ({ i, f: T * x / W - base[i] })).sort((a, b) => b.f - a.f || a.i - b.i);
    for (let k = 0; k < rem; k++) base[frac[k % w.length].i] += 1;
    return base.map(x => sign * x);
  }

  // ---------- gastos compartidos ----------
  const expenseTotalC = e => (e.items?.length ? sumC(e.items.map(i => toCents(i.amount))) : toCents(e.amount));
  // lo que le toca a cada uno, en centavos (iguales, montos / % ya calculados en e.shares, o producto por producto)
  function expenseSharesC(e) {
    const out = {}, add = (n, c) => { out[n] = (out[n] || 0) + c; };
    if (e.shares) Object.entries(e.shares).forEach(([n, v]) => add(n, toCents(v)));
    else if (e.items?.length) e.items.forEach(it => { const who = it.split || []; if (who.length) splitCents(toCents(it.amount), who.length).forEach((c, i) => add(who[i], c)); });
    else { const who = e.split || []; if (who.length) splitCents(toCents(e.amount), who.length).forEach((c, i) => add(who[i], c)); }
    return out;
  }
  function groupBalancesC(g) {
    const bal = Object.fromEntries(g.members.map(m => [m, 0]));
    for (const e of g.expenses || []) {
      bal[e.paidBy] = (bal[e.paidBy] || 0) + expenseTotalC(e);
      for (const [m, c] of Object.entries(expenseSharesC(e))) bal[m] = (bal[m] || 0) - c;
    }
    for (const p of g.payments || []) { const c = toCents(p.amount); bal[p.from] = (bal[p.from] || 0) + c; bal[p.to] = (bal[p.to] || 0) - c; }
    return bal;
  }
  function groupConsumptionC(g) {
    const out = Object.fromEntries(g.members.map(m => [m, { consumed: 0, paid: 0 }]));
    for (const e of g.expenses || []) {
      (out[e.paidBy] ||= { consumed: 0, paid: 0 }).paid += expenseTotalC(e);
      for (const [m, c] of Object.entries(expenseSharesC(e))) (out[m] ||= { consumed: 0, paid: 0 }).consumed += c;
    }
    return out;
  }
  // quién le paga a quién para quedar a mano; trabaja sobre centavos enteros (si Σ = 0, no sobra nada)
  function settleC(bal) {
    const c = [], d = [];
    for (const [n, v] of Object.entries(bal)) { if (v > 0) c.push([n, v]); else if (v < 0) d.push([n, -v]); }
    c.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)); d.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    const out = []; let i = 0, j = 0;
    while (i < c.length && j < d.length) {
      const x = Math.min(c[i][1], d[j][1]);
      out.push({ from: d[j][0], to: c[i][0], c: x, amount: fromCents(x) });
      c[i][1] -= x; d[j][1] -= x;
      if (c[i][1] === 0) i++;
      if (d[j][1] === 0) j++;
    }
    return out;
  }

  // ---------- cuotas ----------
  const cuotaAmountsC = (totalC, n) => splitCents(totalC, Math.max(1, n));
  const debtTotalC = d => (d.total != null ? toCents(d.total) : toCents(d.cuota) * d.cuotas);   // deudas viejas: no traen total, se respeta lo que había
  const cuotaAmountC = (d, i) => (d.total != null ? cuotaAmountsC(toCents(d.total), d.cuotas)[i] ?? 0 : toCents(d.cuota));
  const debtLeftC = d => { let s = 0; for (let i = Math.max(0, d.cuotasPagas || 0); i < d.cuotas; i++) s += cuotaAmountC(d, i); return s; };
  const daysInMonth = (y, m) => new Date(y, m, 0).getDate();   // m: 1-12
  function addMonthsClamped(date, k) {   // '2026-01-31' + 1 mes = '2026-02-28'
    const [y, m, d] = date.split('-').map(Number), t = (y * 12 + (m - 1)) + k, ny = Math.floor(t / 12), nm = (t % 12) + 1;
    return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, daysInMonth(ny, nm))).padStart(2, '0')}`;
  }
  const cuotaDueDate = (d, i) => (d.firstDue ? addMonthsClamped(d.firstDue, i) : null);
  function cuotaStatus(d, i, today) {
    if (i < (d.cuotasPagas || 0)) return 'pagada';
    const due = cuotaDueDate(d, i);
    return due && due < today ? 'vencida' : 'pendiente';
  }

  // ---------- préstamos ----------
  const loanPaidC = l => sumC((l.payments || []).map(p => toCents(p.amount)));
  const loanLeftC = l => Math.max(0, toCents(l.amount) - loanPaidC(l));

  // ---------- plata en cuentas ----------
  // Cada operación que mueve plata de verdad produce un "flujo". Lo que no tiene cuenta (una deuda histórica) no mueve ningún saldo.
  // acc = null: el movimiento cuenta para "tu plata hoy" pero no para una cuenta puntual (así funcionaba hasta ahora).
  function cashFlows(S) {
    const f = [];
    for (const t of S.tx || []) f.push({ acc: t.method || null, date: t.date, c: t.type === 'ingreso' ? toCents(t.amount) : -toCents(t.paid != null ? t.paid : t.amount), kind: 'tx', id: t.id });
    for (const m of S.moves || []) { const c = toCents(m.amount); f.push({ acc: m.from, date: m.date, c: -c, kind: 'move', id: m.id }, { acc: m.to, date: m.date, c, kind: 'move', id: m.id }); }
    for (const a of S.adjusts || []) f.push({ acc: a.acc, date: a.date, c: toCents(a.amount), kind: 'adjust', id: a.id });
    for (const l of S.loans || []) {
      const sg = l.dir === 'me-deben' ? -1 : 1;   // presté → sale plata; me prestaron → entra
      if (l.acc) f.push({ acc: l.acc, date: l.date, c: sg * toCents(l.amount), kind: 'loan', id: l.id });
      for (const p of l.payments || []) if (p.acc) f.push({ acc: p.acc, date: p.date, c: -sg * toCents(p.amount), kind: 'loanpay', id: p.id });   // cobro → entra; pago → sale
    }
    // los gastos de grupo que pagaste vos llegan a tus cuentas como un movimiento vinculado (tx con gref), no desde acá: así no se cuentan dos veces
    for (const g of S.groups || []) {
      for (const p of g.payments || []) if (p.acc) f.push({ acc: p.acc, date: p.date, c: (p.to === 'Yo' ? 1 : -1) * toCents(p.amount), kind: 'gpay', id: p.id });
    }
    for (const d of S.debts || []) for (const p of d.payments || []) if (p.acc && !p.txId) f.push({ acc: p.acc, date: p.date, c: -toCents(p.amount), kind: 'debtpay', id: p.id });
    return f;
  }
  function accBalanceC(S, name, upTo) {
    const k = norm(name);
    const initKey = Object.keys(S.accInit || {}).find(x => norm(x) === k);
    let b = initKey ? toCents(S.accInit[initKey]) : 0;
    for (const x of cashFlows(S)) if (x.acc && norm(x.acc) === k && (!upTo || x.date <= upTo)) b += x.c;
    return b;
  }
  const totalCashC = S => sumC(Object.values(S.accInit || {}).map(toCents)) + sumC(cashFlows(S).map(x => x.c));

  // ---------- duplicados al importar ----------
  // No decide nada: devuelve con qué se parece cada movimiento y por qué, para mostrarlo y que lo decida la persona.
  function findDuplicates(item, tx, opts = {}) {
    const days = opts.days ?? 3, out = [];
    for (const t of tx) {
      if (t.type !== item.kind) continue;
      const dd = Math.abs((Date.parse(t.date + 'T12:00:00Z') - Date.parse(item.date + 'T12:00:00Z')) / 864e5);
      if (!(dd <= days)) continue;
      const exact = toCents(t.amount) === toCents(item.amount);
      if (exact) out.push({ tx: t, level: dd === 0 ? 'igual' : 'parecido', days: dd, exact });
    }
    return out.sort((a, b) => a.days - b.days);
  }

  // ---------- CSV ----------
  function detectDelimiter(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 10);
    let best = ',', score = -1;
    for (const d of [';', ',', '\t', '|']) {
      const counts = lines.map(l => parseCSVLine(l, d).length), c0 = counts[0];
      const ok = c0 > 1 && counts.every(c => c === c0) ? c0 : 0;
      if (ok > score) { score = ok; best = d; }
    }
    return score > 0 ? best : null;
  }
  function parseCSVLine(line, d) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === d) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(x => x.trim());
  }
  function parseCSV(text) {
    const clean = String(text).replace(/^﻿/, '');
    const delimiter = detectDelimiter(clean);
    if (!delimiter) return { ok: false, error: 'No pude reconocer el separador de columnas. Probá con un CSV separado por coma, punto y coma o tabulación.', rows: [] };
    const rows = clean.split(/\r?\n/).filter(l => l.trim()).map(l => parseCSVLine(l, delimiter));
    return { ok: true, delimiter, rows };
  }
  // número "argentino" o "anglo": 1.234,56 · 1,234.56 · 1234,5 · (1.234,56) · 1.234,56- · −1234; ambiguo (1.234 / 1,234) → null con motivo
  function parseNumber(raw) {
    let s = String(raw ?? '').trim().replace(/[$\s]|ARS|USD/gi, '');
    if (!s) return { value: null, issue: 'vacío' };
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
    if (/^[-−–]/.test(s)) { neg = true; s = s.slice(1); }
    if (/^\+/.test(s)) s = s.slice(1);
    if (!/^[\d.,]+$/.test(s)) return { value: null, issue: 'no es un número' };
    const dots = (s.match(/\./g) || []).length, commas = (s.match(/,/g) || []).length;
    let n, amb = null;
    if (dots && commas) { const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(','); n = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, ''); }
    else if (commas) { const p = s.split(','); if (commas === 1 && p[1].length !== 3) n = s.replace(',', '.'); else if (commas === 1) { n = s.replace(',', '.'); amb = 'coma: ¿decimales o miles?'; } else n = s.replace(/,/g, ''); }
    else if (dots) { const p = s.split('.'); if (dots === 1 && p[1].length !== 3) n = s; else if (dots === 1) { n = s.replace('.', ''); amb = 'punto: ¿decimales o miles?'; } else n = s.replace(/\./g, ''); }
    else n = s;
    const v = Number(n); if (!isFinite(v)) return { value: null, issue: 'no es un número' };
    return { value: (neg ? -1 : 1) * v, issue: amb };
  }
  // fechas: 2026-10-05 · 05/10/2026 · 5-10-26; dd/mm/aa se asume salvo que se indique 'mdy'; si ambas lecturas son posibles se marca dudosa
  function parseDate(raw, order = 'dmy') {
    const s = String(raw ?? '').trim();
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    const valid = (y, mo, d) => mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
    const fmt = (y, mo, d) => `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (m) { const [y, mo, d] = [+m[1], +m[2], +m[3]]; return valid(y, mo, d) ? { value: fmt(y, mo, d), issue: null } : { value: null, issue: 'fecha inválida' }; }
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)/);
    if (!m) return { value: null, issue: 'fecha ilegible' };
    let a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000;
    const [d, mo] = order === 'mdy' ? [b, a] : [a, b];
    if (!valid(y, mo, d)) return { value: null, issue: 'fecha inválida' };
    return { value: fmt(y, mo, d), issue: a <= 12 && b <= 12 && a !== b ? 'fecha ambigua (día/mes)' : null };
  }
  // columnas sugeridas a partir del encabezado
  function guessColumns(header) {
    const find = re => header.findIndex(h => re.test(norm(h)));
    return { date: find(/fecha|date|dia/), desc: find(/descrip|concepto|detalle|movimiento|referencia|comercio|nota/), amount: find(/^(importe|monto|amount|valor)$|importe|monto/), debit: find(/debito|egreso|gasto|salida|retiro/), credit: find(/credito|ingreso|entrada|deposito|haber/) };
  }
  // filas → movimientos con estado: 'nuevo' (datos claros) o 'revisar' (hay algo dudoso, con el motivo)
  function csvToMovements(rows, map, opts = {}) {
    const out = [], errors = [];
    rows.forEach((r, idx) => {
      const issues = [];
      const dt = parseDate(r[map.date], opts.dateOrder || 'dmy'); if (!dt.value) issues.push(dt.issue || 'sin fecha'); else if (dt.issue) issues.push(dt.issue);
      let amount = null, kind = null;
      if (map.amount >= 0) { const n = parseNumber(r[map.amount]); if (n.value == null) issues.push('importe: ' + n.issue); else { amount = Math.abs(n.value); kind = n.value < 0 ? 'gasto' : 'ingreso'; if (n.issue) issues.push('importe ambiguo (' + n.issue + ')'); if (n.value === 0) issues.push('importe cero'); } }
      else if (map.debit >= 0 || map.credit >= 0) {
        const d = map.debit >= 0 && String(r[map.debit] || '').trim() ? parseNumber(r[map.debit]) : null, c = map.credit >= 0 && String(r[map.credit] || '').trim() ? parseNumber(r[map.credit]) : null;
        if (d && c) issues.push('tiene débito y crédito a la vez');
        const x = d || c; if (!x) issues.push('sin importe'); else if (x.value == null) issues.push('importe: ' + x.issue); else { amount = Math.abs(x.value); kind = d ? 'gasto' : 'ingreso'; if (x.issue) issues.push('importe ambiguo (' + x.issue + ')'); }
      } else issues.push('sin columna de importe');
      const desc = String(r[map.desc] ?? '').trim() || 'Movimiento';
      if (amount == null || !dt.value) { errors.push({ row: idx + 1, issues }); }
      out.push({ row: idx + 1, date: dt.value, amount, kind, description: desc, issues, status: !issues.length ? 'nuevo' : 'revisar', unusable: amount == null || !dt.value });
    });
    return { items: out, errors };
  }

  // ---------- esquema y migración ----------
  const arr = x => (Array.isArray(x) ? x : []);
  const isNum = x => typeof x === 'number' && isFinite(x);
  const safeId = (o, uid) => ({ ...o, id: String(o.id ?? '').replace(/[^\w-]/g, '') || uid() });
  // deja el estado con la forma esperada (listas siempre presentes, sin registros dañados, ids seguros para ir en atributos HTML)
  function normalize(v, uid) {
    const strs = x => arr(x).filter(m => typeof m === 'string');
    return {
      ...v,
      tx: arr(v.tx).filter(t => t && typeof t.date === 'string' && isNum(t.amount)).map(t => safeId(t, uid)),
      debts: arr(v.debts).filter(d => d && isNum(d.cuota) && d.cuotas > 0).map(d => ({ ...safeId(d, uid), payments: arr(d.payments).filter(Boolean).map(p => safeId(p, uid)) })),
      loans: arr(v.loans).filter(l => l && isNum(l.amount)).map(l => ({ ...safeId(l, uid), person: String(l.person ?? '').trim() || 'Sin nombre', payments: arr(l.payments).filter(Boolean).map(p => safeId(p, uid)) })),
      moves: arr(v.moves).filter(m => m && isNum(m.amount) && m.from && m.to).map(m => safeId(m, uid)),
      adjusts: arr(v.adjusts).filter(a => a && isNum(a.amount) && typeof a.acc === 'string' && typeof a.date === 'string').map(a => safeId(a, uid)),
      imports: arr(v.imports).filter(Boolean).map(i => safeId(i, uid)),
      customMethods: strs(v.customMethods).filter(x => x.trim()),
      accInit: v.accInit && typeof v.accInit === 'object' ? v.accInit : {},
      groups: arr(v.groups).filter(g => g && Array.isArray(g.members)).map(g => ({ ...safeId(g, uid), members: strs(g.members), hidden: strs(g.hidden), expenses: arr(g.expenses).filter(e => e && isNum(e.amount) && Array.isArray(e.split)).map(e => safeId(e, uid)), payments: arr(g.payments).filter(Boolean).map(p => safeId(p, uid)) }))
    };
  }
  const versionOf = v => (v && Number.isInteger(v.schemaVersion) ? v.schemaVersion : 1);
  const needsMigration = v => versionOf(v) < SCHEMA;
  // migrar = normalizar + marcar la versión. Es aditivo (no reescribe ni borra movimientos), idempotente y no muta el original.
  function migrate(raw, uid) {
    const from = versionOf(raw), next = normalize(JSON.parse(JSON.stringify(raw)), uid);
    next.schemaVersion = SCHEMA;
    return { state: next, from, to: SCHEMA, migrated: from < SCHEMA };
  }
  // resumen de un backup para mostrarlo antes de restaurar
  function summarize(v) {
    const tx = arr(v.tx), dates = tx.map(t => t.date).filter(d => typeof d === 'string').sort();
    return { movements: tx.length, accounts: Object.keys(v.accInit || {}).length + arr(v.customMethods).length, loans: arr(v.loans).length, debts: arr(v.debts).length, groups: arr(v.groups).length, from: dates[0] || null, to: dates.at(-1) || null, version: versionOf(v), exportedAt: v._meta?.at || null };
  }

  // ---------- guardado seguro ----------
  // Se intenta el almacén principal y, si falla, el de reserva. Si fallan los dos, se avisa con un error: nunca se finge un guardado.
  async function persist(primary, secondary) {
    try { await primary(); return 'principal'; }
    catch (e1) {
      try { await secondary(); return 'reserva'; }
      catch (e2) { const err = new Error('No se pudo guardar en este dispositivo'); err.causes = [e1, e2]; throw err; }
    }
  }
  // al leer: si hubo un guardado en la reserva más nuevo que el del almacén principal, gana el más nuevo (savedAt = ISO)
  const chooseNewest = (a, b) => (!a ? b : !b ? a : String(b.savedAt || '') > String(a.savedAt || '') ? b : a);

  return { persist, chooseNewest, SCHEMA, norm, toCents, fromCents, round2, sumC, splitCents, expenseTotalC, expenseSharesC, groupBalancesC, groupConsumptionC, settleC, cuotaAmountsC, debtTotalC, cuotaAmountC, debtLeftC, addMonthsClamped, cuotaDueDate, cuotaStatus, loanPaidC, loanLeftC, cashFlows, accBalanceC, totalCashC, findDuplicates, parseCSV, parseCSVLine, detectDelimiter, parseNumber, parseDate, guessColumns, csvToMovements, normalize, versionOf, needsMigration, migrate, summarize };
});
