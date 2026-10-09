'use strict';
/* Plata — control de gastos, deudas y plata prestada. Local-first: todo vive en el dispositivo. */

// ---------- versión y actualizaciones ----------
// La versión sale del nombre de la caché del service worker (plata-vN), así no se duplica en dos lugares.
async function showVersion() {
  const el = $('#app-ver'); if (!el) return;
  try {
    const n = (await caches.keys()).filter(k => k.startsWith('plata-v')).map(k => +k.slice(7)).filter(Boolean).sort((a, b) => b - a)[0];
    el.textContent = n ? 'Versión ' + n : 'Versión sin instalar';
  } catch { el.textContent = ''; }
}
if ('serviceWorker' in navigator) {
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) $('#update').hidden = false; hadController = true; });
}

// ---------- instalación (Android / Chrome) ----------
let installEv = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEv = e; });
addEventListener('appinstalled', () => { installEv = null; });

// ---------- tema (claro / oscuro) ----------
// Mientras la persona no elija, se sigue el tema del teléfono; al elegir, queda fijo.
const THEME_BG = { light: '#e9f1ec', dark: '#0b1511' };
const storedTheme = () => { try { const t = localStorage.getItem('plata.theme'); return t === 'light' || t === 'dark' ? t : null; } catch { return null; } };
const getTheme = () => storedTheme() || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
function applyTheme(t) {
  const root = document.documentElement;
  root.setAttribute('data-theme', t);
  // El filtro de "oscurecer sitios" de Android solo respeta a las páginas que declaran soportar el modo oscuro;
  // por eso incluso en Claro se declara "light dark" y los colores claros los pintamos nosotros.
  const cs = t === 'light' ? 'light dark' : 'dark';
  root.style.colorScheme = cs;
  const meta = document.querySelector('meta[name=color-scheme]'); if (meta) meta.content = cs;
  document.querySelectorAll('meta[name=theme-color]').forEach(m => { m.dataset.orig ||= m.content; m.content = THEME_BG[t]; });
}
if (storedTheme()) applyTheme(storedTheme());

// ---------- utilidades ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Montos: el punto separa miles y la coma los decimales (siempre, también en cifras de 4 dígitos: 1.234)
const NF = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
// ojo de "ocultar montos": mientras se dibuja una pantalla principal (Inicio, Por mes, Deudas, Grupos) las cifras salen como $ ••••
const prefGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch { return d; } };
const prefSet = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { } };
const bigCls = t => (t.length > 17 ? 'xs' : t.length > 13 ? 'sm' : ''), statCls = t => (t.length > 12 ? ' sm' : '');
let HIDE = prefGet('plata.hide', false), masking = false, homeDet = prefGet('plata.det', false);
const withMask = fn => { masking = HIDE; try { return fn(); } finally { masking = false; } };
const money = n => { if (masking) return '$ ••••'; n = Math.round((Number(n) || 0) * 100) / 100; return (n < 0 ? '-' : '') + '$ ' + NF.format(Math.abs(n)); };
const fmtIn = n => (n === '' || n == null || isNaN(n)) ? '' : NF.format(Math.round(Number(n) * 100) / 100);   // para precargar un campo de monto
// campo de monto con el símbolo $ fijo a la izquierda
const MI = (inputHtml, big) => `<span class="mi${big ? ' big' : ''}"><span class="cur" aria-hidden="true">$</span>${inputHtml}</span>`;
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const sum = (a, f = x => x) => a.reduce((s, x) => s + f(x), 0);
// Supuesto de la app: la coma es el separador decimal y el punto el de miles ("1.234,5" = 1234,5)
const parseAmount = v => {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim().replace(/[\s$]/g, '');
  if (!s) return NaN;
  return parseFloat(s.replace(/\./g, '').replace(',', '.'));
};
// mientras se escribe: agrupa los miles con puntos, deja la coma para los decimales (máx. 2) y conserva el cursor
function fmtMoneyInput(el, e) {
  let s = el.value, caret = el.selectionStart ?? s.length;
  const neg = el.classList.contains('i-amt') && /[-\u2212\u2013]/.test(s);   // los precios de producto pueden ser negativos (descuentos)
  const last = el._last ?? el.defaultValue ?? '';
  if (e && e.inputType === 'deleteContentBackward' && last.length === s.length + 1 && last[caret] === '.' && last.slice(0, caret) + last.slice(caret + 1) === s) { s = last.slice(0, caret - 1) + last.slice(caret + 1); caret = Math.max(caret - 1, 0); }   // borrar un punto de miles borra el dígito anterior
  else if (e && e.inputType === 'insertText' && e.data && e.data.includes('.')) s = s.slice(0, caret - e.data.length) + e.data.replace(/\./g, ',') + s.slice(caret);   // un punto tipeado = coma decimal
  else if (s.length === last.length + 1 && s[caret - 1] === '.' && !(e && e.inputType === 'insertFromPaste')) s = s.slice(0, caret - 1) + ',' + s.slice(caret);
  else if (e && e.inputType === 'insertFromPaste') {
    const t = s.replace(/[\s$]/g, '');
    s = t.includes(',') ? t : /^\d{1,3}(\.\d{3})+$/.test(t) ? t : /^\d+\.\d{1,2}$/.test(t) ? t.replace('.', ',') : t;
    caret = s.length;
  }
  let sig = s.slice(0, caret).replace(/[^\d,]/g, '').length;
  const clean = s.replace(/[^\d,]/g, ''), ci = clean.indexOf(',');
  let int = ci < 0 ? clean : clean.slice(0, ci);
  const dec = ci < 0 ? null : clean.slice(ci + 1).replace(/,/g, '').slice(0, 2);
  int = int.replace(/^0+(?=\d)/, '');
  if (!int && dec !== null) { int = '0'; sig++; }
  const out = (neg && (int || dec !== null) ? '-' : '') + int.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (dec !== null ? ',' + dec : '');
  el.value = el._last = out;
  let pos = 0, n = 0; while (pos < out.length && n < sig) { if (/[\d,]/.test(out[pos])) n++; pos++; }
  try { el.setSelectionRange(pos, pos); } catch { /* algunos teclados no lo permiten */ }
}
document.addEventListener('input', e => { if (e.target.matches?.('input[inputmode=decimal]')) fmtMoneyInput(e.target, e); }, true);
const monthLabel = m => { const s = new Date(m + '-15').toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }).replace(' de ', ' '); return s[0].toUpperCase() + s.slice(1); };
const shiftMonth = (m, d) => { const [y, mo] = m.split('-').map(Number); const dt = new Date(y, mo - 1 + d, 1); return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0'); };
const dayLabel = d => new Date(d + 'T12:00').toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' });

const CATS = {
  gasto: [['Comida', '🍽️'], ['Transporte', '🚌'], ['Hogar', '🏠'], ['Salud', '💊'], ['Ocio', '🎬'], ['Compras', '🛍️'], ['Servicios', '💡'], ['Educación', '📚'], ['Deudas', '💳'], ['Otros', '•']],
  ingreso: [['Sueldo', '💼'], ['Freelance', '🧾'], ['Otros ingresos', '＋']]
};
const catIcon = c => ([...CATS.gasto, ...CATS.ingreso].find(x => x[0] === c) || [0, '•'])[1];
const stamp = s => esc(String(s || '•').trim()[0]?.toUpperCase() || '•');
const METHODS = ['Efectivo', 'Débito', 'Crédito', 'Transferencia', 'Mercado Pago', 'Otro'];

// ---------- estado + persistencia (IndexedDB con respaldo a localStorage) ----------
let S = { tx: [], debts: [], loans: [], groups: [] };
const DB = 'plata', KEY = 'state';
const idb = () => new Promise((res, rej) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
// deja el estado con la forma que la app espera (listas siempre presentes, sin registros dañados)
function normState(v) {
  const arr = x => Array.isArray(x) ? x : [], num = x => typeof x === 'number' && isFinite(x);
  return {
    ...v,
    tx: arr(v.tx).filter(t => t && typeof t.date === 'string' && num(t.amount)),
    debts: arr(v.debts).filter(d => d && num(d.cuota) && d.cuotas > 0),
    loans: arr(v.loans).filter(l => l && num(l.amount)).map(l => ({ ...l, person: String(l.person ?? '').trim() || 'Sin nombre', payments: arr(l.payments) })),
    moves: arr(v.moves).filter(m => m && num(m.amount) && m.from && m.to),
    customMethods: arr(v.customMethods).filter(x => typeof x === 'string' && x.trim()),
    accInit: v.accInit && typeof v.accInit === 'object' ? v.accInit : {},
    groups: arr(v.groups).filter(g => g && Array.isArray(g.members)).map(g => ({ ...g, expenses: arr(g.expenses).filter(e => e && num(e.amount) && Array.isArray(e.split)), payments: arr(g.payments) }))
  };
}
async function load() {
  try {
    const db = await idb();
    const v = await new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(KEY); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    if (v) S = normState({ ...S, ...v });
  } catch { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v) S = normState({ ...S, ...v }); } catch { } }
}
async function save() {
  try {
    const db = await idb();
    await new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(JSON.parse(JSON.stringify(S)), KEY); t.oncomplete = res; t.onerror = () => rej(t.error); });
  } catch { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { } }
}
const commit = () => { save(); render(); };

// ---------- cálculos ----------
const loanPaid = l => sum(l.payments || [], p => p.amount);
const loanLeft = l => Math.max(0, l.amount - loanPaid(l));
const debtLeft = d => Math.max(0, (d.cuotas - d.cuotasPagas) * d.cuota);
const daysUntil = day => {
  const n = new Date(), y = n.getFullYear(), m = n.getMonth();
  let t = new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));
  if (t < new Date(y, m, n.getDate())) t = new Date(y, m + 1, Math.min(day, new Date(y, m + 2, 0).getDate()));
  return Math.round((t - new Date(y, m, n.getDate())) / 864e5);
};
const personName = l => String(l.person ?? '').trim() || 'Sin nombre';
const personKey = l => personName(l).toLowerCase();
function peopleList() {
  const map = {};
  for (const l of S.loans) {
    const k = personKey(l); const left = loanLeft(l);
    const p = map[k] ||= { key: k, name: personName(l), net: 0, phone: '' };
    p.net += (l.dir === 'me-deben' ? 1 : -1) * left;
    if (l.phone) p.phone = l.phone;
  }
  return Object.values(map).sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
}
// lo que le toca a cada uno de un gasto: partes iguales, o producto por producto si trae `items`
function expenseShares(e) {
  const out = {}, add = (n, v) => out[n] = (out[n] || 0) + v;
  if (e.items?.length) e.items.forEach(it => { if (it.split?.length) it.split.forEach(n => add(n, it.amount / it.split.length)); });
  else e.split.forEach(n => add(n, e.amount / e.split.length));
  return out;
}
function groupBalances(g) {
  const bal = Object.fromEntries(g.members.map(m => [m, 0]));
  for (const e of g.expenses) {
    bal[e.paidBy] = (bal[e.paidBy] || 0) + e.amount;
    for (const [m, v] of Object.entries(expenseShares(e))) bal[m] = (bal[m] || 0) - v;
  }
  // pagos ya hechos entre integrantes: quien paga reduce lo que debe; quien cobra reduce lo que le deben
  for (const p of g.payments || []) { bal[p.from] = (bal[p.from] || 0) + p.amount; bal[p.to] = (bal[p.to] || 0) - p.amount; }
  return bal;
}
// consumo y aporte de cada integrante
function groupConsumption(g) {
  const c = Object.fromEntries(g.members.map(m => [m, { consumed: 0, paid: 0 }]));
  for (const e of g.expenses) {
    (c[e.paidBy] ||= { consumed: 0, paid: 0 }).paid += e.amount;
    for (const [m, v] of Object.entries(expenseShares(e))) (c[m] ||= { consumed: 0, paid: 0 }).consumed += v;
  }
  return c;
}
function settle(bal) {
  const c = [], d = [];
  for (const [n, v] of Object.entries(bal)) { if (v > 0.005) c.push([n, v]); else if (v < -0.005) d.push([n, -v]); }
  c.sort((a, b) => b[1] - a[1]); d.sort((a, b) => b[1] - a[1]);
  const out = []; let i = 0, j = 0;
  while (i < c.length && j < d.length) {
    const x = Math.min(c[i][1], d[j][1]);
    out.push({ from: d[j][0], to: c[i][0], amount: x });
    c[i][1] -= x; d[j][1] -= x;
    if (c[i][1] < 0.005) i++; if (d[j][1] < 0.005) j++;
  }
  return out;
}

// ---------- vistas ----------
let view = 'home', month = today().slice(0, 7), openGroup = null;
const TITLES = { home: 'Inicio', mov: 'Por mes', split: 'Dividir', groups: 'Grupos', debts: 'Deudas y cobros' };
// aplica un cambio de estado y vuelve a dibujar sin animación y manteniendo el scroll
function keepView(change) {
  const sc = $('#scroll'), y = sc.scrollTop, main = $('#main'); main.classList.add('still'); change(); render(); sc.scrollTo({ top: y, behavior: 'instant' });
  requestAnimationFrame(() => main.classList.remove('still'));
}
let debtsTab = 'people';   // 'people' (me deben / debo) | 'cards' (tarjetas, cuotas, préstamos)

const empty = (t, s) => `<div class="empty"><b>${t}</b>${s}</div>`;

function vHome() {
  const cur = today().slice(0, 7), tx = S.tx.filter(t => t.date.startsWith(cur));
  const inc = sum(S.tx.filter(t => t.type === 'ingreso'), t => t.amount);
  const exp = sum(S.tx.filter(t => t.type === 'gasto'), t => t.amount);
  const owedMe = sum(S.loans.filter(l => l.dir === 'me-deben'), loanLeft);
  const iOwe = sum(S.loans.filter(l => l.dir === 'debo'), loanLeft) + sum(S.debts, debtLeft);
  const due = S.debts.filter(d => d.cuotasPagas < d.cuotas && d.dueDay).map(d => ({ d, n: daysUntil(d.dueDay) })).filter(x => x.n <= 10).sort((a, b) => a.n - b.n);
  // Balance general = lo que realmente tenés: ingresos − gastos + el saldo inicial que cargaste en cada cuenta
  const initSum = sum(Object.values(S.accInit || {}), v => Number(v) || 0), balance = inc - exp + initSum;
  // resumen del mes: cuánto cambió el balance este mes y, si sobró plata, cuánto queda por día hasta fin de mes
  const mInc = sum(tx.filter(t => t.type === 'ingreso'), t => t.amount), mExp = sum(tx.filter(t => t.type === 'gasto'), t => t.amount), mNet = mInc - mExp;
  const nowD = new Date(), daysLeft = new Date(nowD.getFullYear(), nowD.getMonth() + 1, 0).getDate() - nowD.getDate() + 1;
  const insight = S.tx.length ? `<div class="insight"><b class="${mNet < 0 ? 'neg' : 'pos'}">${mNet < 0 ? '▼' : '▲'} ${money(Math.abs(mNet))}</b> este mes${mNet > 0 && daysLeft > 0 ? ` · te quedan <b>${money(Math.round(mNet / daysLeft))}</b> por día` : ''}</div>` : '';
  // desglose por cuenta (se abre con "Ver detalle")
  const accs = allMethods().filter(accShown).map(n => ({ n, b: accBalance(n) })).sort((x, y) => Math.abs(y.b) - Math.abs(x.b));
  const loose = sum(S.tx.filter(t => !t.method), t => (t.type === 'ingreso' ? 1 : -1) * t.amount), posTot = sum(accs, a => Math.max(0, a.b));
  const drows = accs.map(a => `<button class="drow" data-act="accsum" data-n="${esc(a.n)}"><i style="background:var(--c${METHOD_SLOT[a.n] || hashSlot(a.n)})"></i><span>${esc(a.n)}${a.b > 0 && posTot ? `<small>${Math.round(a.b / posTot * 100)}%</small>` : ''}</span><b class="${a.b < 0 ? 'neg' : ''}">${money(a.b)}</b></button>`).join('')
    + (Math.abs(loose) > 0.005 ? `<div class="drow"><i style="background:transparent;box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.5)"></i><span>Sin cuenta<small>sin asignar</small></span><b class="${loose < 0 ? 'neg' : ''}">${money(loose)}</b></div>` : '');
  const eye = HIDE ? '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6A17 17 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 4.2-.9M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  return `
  <div class="card hero">
    <div class="toprow"><div class="label">Balance general</div><button class="eye" data-act="hide" aria-label="${HIDE ? 'Mostrar montos' : 'Ocultar montos'}" aria-pressed="${HIDE}">${eye}</button></div>
    <div class="big ${balance < 0 ? 'neg' : ''} ${bigCls(money(balance))}">${money(balance)}</div>
    ${insight}
    ${drows ? `<button class="det" data-act="hdet" aria-expanded="${homeDet}"><i></i><span>${homeDet ? 'Detalle ▴' : 'Ver detalle ▾'}</span><i></i></button><div class="drows"${homeDet ? '' : ' hidden'}>${drows}</div>` : ''}
    <div class="pair"><div><span class="label">Ingresos</span><b class="pos">${money(inc)}</b></div><div><span class="label">Gastos</span><b class="neg">${money(exp)}</b></div></div>
  </div>
  ${owedMe || iOwe ? `<button class="card" data-act="tab" data-v="debts" style="text-align:left;width:100%"><div class="row"><div><div class="label">Me deben</div><div class="stat ${owedMe ? 'pos' : 'muted'}${statCls(money(Math.max(owedMe, iOwe)))}">${money(owedMe)}</div></div><div style="text-align:right"><div class="label">Debo</div><div class="stat ${iOwe ? 'neg' : 'muted'}${statCls(money(Math.max(owedMe, iOwe)))}">${money(iOwe)}</div></div></div></button>` : ''}
  ${due.length ? `<h3>Vencimientos cercanos</h3><div class="list">${due.map(({ d, n }) => `
    <button class="item" data-act="debt" data-id="${d.id}"><div class="dot">${stamp(d.name)}</div><div class="grow"><div class="t">${esc(d.name)}</div>
    <div class="s ${n <= 3 ? 'warn' : ''}">${n === 0 ? 'Vence hoy' : n === 1 ? 'Vence mañana' : 'Vence en ' + n + ' días'}</div></div><div class="amt neg">${money(d.cuota)}</div></button>`).join('')}</div>` : ''}
  <div id="bk">${breakdownCard(tx, monthLabel(cur))}</div>
  <h3>Últimos movimientos</h3><div class="card" style="padding:6px 14px">${txList(S.tx.slice().sort(byDate).slice(0, 5))}${S.tx.length ? `<div class="btns" style="margin:4px 0 8px"><button class="btn ghost block" data-act="tab" data-v="mov">Ver por mes</button></div>` : ''}</div>`;
}

// ---------- gastos por categoría / método de pago (cinta + leyenda) ----------
// El color sigue a la categoría (no a su posición): cada nombre tiene un color preferido y, si dos chocan, el segundo toma el siguiente libre.
let homeSeg = 'cat';
const CAT_SLOT = { Comida: 1, Ocio: 2, Transporte: 3, Servicios: 4, Compras: 5 };
const METHOD_SLOT = { 'Débito': 1, 'Crédito': 2, 'Mercado Pago': 3, 'Efectivo': 4, 'Transferencia': 5 };
const hashSlot = n => { let h = 0; for (const ch of norm(n)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % 5 + 1; };
function assignSlots(names, pref) {
  const used = new Set(), out = {};
  for (const n of names) { let s = pref(n); for (let i = 0; i < 5 && used.has(s); i++) s = s % 5 + 1; used.add(s); out[n] = s; }
  return out;
}
function breakdownCard(tx, when) {
  const gastos = tx.filter(t => t.type === 'gasto'), total = sum(gastos, t => t.amount), byMet = homeSeg === 'met';
  const title = (byMet ? 'Gastos por método de pago' : 'Gastos por categoría') + (when ? ` <span class="muted" style="font:500 14px var(--sans)">· ${esc(when)}</span>` : '');
  if (!gastos.length) return `<h3>${title}</h3><div class="card"><div class="muted">Sin gastos este mes todavía.</div></div>`;
  const bucket = {};
  gastos.forEach(t => { const k = byMet ? (t.method || 'Sin método') : t.cat; bucket[k] = (bucket[k] || 0) + t.amount; });
  const all = Object.entries(bucket).sort((a, b) => b[1] - a[1]), top = all.slice(0, 5), rest = sum(all.slice(5), e => e[1]);
  const slots = assignSlots(top.map(e => e[0]).filter(n => n !== 'Sin método'), byMet ? n => METHOD_SLOT[n] || hashSlot(n) : n => CAT_SLOT[n] || hashSlot(n));
  const rows = top.map(([n, v]) => ({ n, v, c: slots[n] || 6 }));
  if (rest > 0) rows.push({ n: 'Otras', v: rest, c: 6 });
  return `<h3>${title}</h3><div class="card">
    <div class="tog" role="group" aria-label="Agrupar gastos por"><button class="${byMet ? '' : 'on'}" data-act="hseg" data-v="cat" aria-pressed="${!byMet}">Categoría</button><button class="${byMet ? 'on' : ''}" data-act="hseg" data-v="met" aria-pressed="${byMet}">Método de pago</button></div>
    <div class="rib" role="img" aria-label="${esc(rows.map(r => r.n + ' ' + Math.round(r.v / total * 100) + '%').join(', '))}">${rows.map(r => `<i style="flex:${r.v};background:var(--c${r.c})"></i>`).join('')}</div>
    <div class="lgd${rows.some(r => money(r.v).length > 12) ? ' long' : ''}">${rows.map(r => `<div><span><i style="background:var(--c${r.c})"></i><em class="n">${esc(r.n)}</em></span><b class="neg">${money(r.v)}<small>${Math.round(r.v / total * 100)}%</small></b></div>`).join('')}</div></div>`;
}
// al cambiar entre categoría y método de pago solo se actualiza esa tarjeta (no se vuelve a dibujar la pantalla)
function swapBreakdown() {
  const box = $('#bk'); if (!box) return;
  const cur = today().slice(0, 7), tmp = document.createElement('div');
  tmp.innerHTML = withMask(() => breakdownCard(S.tx.filter(t => t.date.startsWith(cur)), monthLabel(cur)));
  box.querySelector('h3').innerHTML = tmp.querySelector('h3').innerHTML;
  box.querySelectorAll('.tog button').forEach(b => { const on = b.dataset.v === homeSeg; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  for (const sel of ['.rib', '.lgd']) { const a = box.querySelector(sel), b = tmp.querySelector(sel); if (a && b) { b.classList.add('swap'); a.replaceWith(b); } }
}
// círculo con el ícono y el color de la categoría (el mismo que en la cinta de Inicio); sin ícono propio queda la inicial
const CAT_SVG = {
  Comida: '<path d="M7 3v8M4.5 3v5a2.5 2.5 0 0 0 5 0V3M7 11v10M17 21V3c-2.5 1.5-3.5 4-3.5 7.5H17"/>',
  Transporte: '<rect x="4" y="3.5" width="16" height="13" rx="3"/><path d="M4 11h16M8 20v-3.5M16 20v-3.5"/><circle cx="8.5" cy="14" r=".6"/><circle cx="15.5" cy="14" r=".6"/>',
  Super: '<path d="M3 4h2.5l2 11h10l2-8H6.5"/><circle cx="9" cy="19" r="1.3"/><circle cx="17" cy="19" r="1.3"/>',
  Ocio: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8 6.8 19.6l1-5.8L3.5 9.7l5.9-.8z"/>',
  Salud: '<path d="M12 5v14M5 12h14"/>',
  Hogar: '<path d="M4 11l8-7 8 7M6 10v10h12V10"/>',
  Compras: '<path d="M5 8h14l-1 12H6L5 8zM9 8a3 3 0 0 1 6 0"/>',
  Servicios: '<path d="M13 3L5 13h6l-1 8 8-10h-6z"/>',
  Educación: '<path d="M4 5.5C6 4.5 9 4.5 12 6c3-1.5 6-1.5 8-.5V19c-2-1-5-1-8 .5-3-1.5-6-1.5-8-.5zM12 6v13.5"/>',
  Deudas: '<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M3 10.5h18"/>',
  Otros: '<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>',
  Sueldo: '<path d="M12 4v13M6.5 11.5L12 17l5.5-5.5M5 21h14"/>',
  Freelance: '<path d="M7 3h8l4 4v14H7zM15 3v4h4"/>',
  'Otros ingresos': '<path d="M12 5v14M5 12h14"/>'
};
// categorías que creó la persona: se reconocen por la palabra (café, súper, nafta…); si no, queda la inicial
const CAT_WORDS = [[/caf[eé]|resto|comida|almuerzo|cena|delivery|pizza/, 'Comida'], [/super|almac[eé]n|verdul|carnic|mercado/, 'Super'], [/nafta|combust|subte|colectivo|bondi|uber|taxi|peaje|tren/, 'Transporte'], [/alquiler|expensas|casa|hogar/, 'Hogar'], [/farmac|m[eé]dic|salud|gym|gimnas/, 'Salud'], [/cine|salida|ocio|juego|netflix|spotify/, 'Ocio'], [/luz|gas|agua|internet|wifi|tel[eé]f|servicio/, 'Servicios'], [/ropa|compra/, 'Compras'], [/curso|escuela|facultad|libro|educaci/, 'Educación']];
const catSvg = c => CAT_SVG[c] || (CAT_SVG[(CAT_WORDS.find(([re]) => re.test(norm(c))) || [])[1]] ?? '');
const catDot = c => {
  const k = CAT_SLOT[c] || hashSlot(c), p = catSvg(c);
  return `<div class="dot${k === 5 ? ' d5' : ''}" style="background:var(--c${k})">${p ? `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>` : stamp(c)}</div>`;
};
const byDate = (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id);
const monthNav = () => `<div class="month"><button data-act="mprev" aria-label="Mes anterior">‹</button><b>${monthLabel(month)}</b><button data-act="mnext" aria-label="Mes siguiente">›</button></div>`;
const txItem = t => `
  <button class="item" data-act="tx" data-id="${t.id}">${catDot(t.cat)}
  <div class="grow"><div class="t">${esc(t.note || t.cat)}</div><div class="s">${esc([t.note ? t.cat : '', t.method].filter(Boolean).join(' · ') || ' ')}</div></div>
  <div class="amt ${t.type === 'ingreso' ? 'pos' : 'neg'}">${t.type === 'ingreso' ? '+' : '−'}${money(t.amount)}</div></button>`;
// un traspaso entre cuentas no es ingreso ni gasto: va con el símbolo ⇄ y sin color
const moveItem = t => `
  <button class="item" data-act="mvundo" data-id="${t.id}"><div class="dot tr">⇄</div>
  <div class="grow"><div class="t">${t.out ? 'Traspaso a ' : 'Traspaso desde '}${esc(t.other)}</div><div class="s">Tocá para deshacer</div></div>
  <div class="amt">${t.amount > 0 ? '+' : '−'}${money(Math.abs(t.amount))}</div></button>`;
const dayHead = d => { const t = today(), y = new Date(t + 'T12:00'); y.setDate(y.getDate() - 1); return d === t ? 'Hoy' : d === y.toISOString().slice(0, 10) ? 'Ayer' : dayLabel(d); };
const txList = (arr, compact) => {
  if (!arr.length) return `<div class="list">${empty('Todavía no hay movimientos', 'Tocá + para cargar el primero.')}</div>`;
  const row = t => t._m ? moveItem(t) : txItem(t);
  if (compact) return `<div class="list">${arr.map(row).join('')}</div>`;
  let out = '', i = 0;
  while (i < arr.length) {
    const d = arr[i].date, grp = [];
    while (i < arr.length && arr[i].date === d) grp.push(arr[i++]);
    const gasto = sum(grp.filter(t => !t._m && t.type === 'gasto'), t => t.amount);
    out += `<div class="dayh"><span>${dayHead(d)}</span><b>${gasto ? '−' + money(gasto) : 'Sin gastos'}</b></div>${grp.map(row).join('')}`;
  }
  return `<div class="list">${out}</div>`;
};
// movimientos y traspasos de una cuenta (más recientes primero); inRange decide qué fechas entran
function accRows(name, inRange) {
  const k = norm(name);
  const tx = S.tx.filter(t => norm(t.method) === k && inRange(t.date));
  const mv = (S.moves || []).filter(m => (norm(m.from) === k || norm(m.to) === k) && inRange(m.date)).map(m => { const out = norm(m.from) === k; return { _m: 1, id: m.id, date: m.date, amount: out ? -m.amount : m.amount, out, other: out ? m.to : m.from }; });
  return [...tx, ...mv].sort(byDate);
}
// qué cuentas se ofrecen como fichas: las usadas, las creadas y Efectivo / Mercado Pago (los medios de fábrica sin uso no ensucian)
const accShown = n => accUsed(n) || (S.customMethods || []).some(c => c === n) || ['Efectivo', 'Mercado Pago'].includes(n);
let movAcc = 'all';   // 'all' o el nombre de la cuenta que se está mirando en Por mes

// ---------- ver por mes: resumen del mes + calendario de gasto por día + día elegido + lista ----------
let selDay = null, movFilter = 'all';
const dayLong = d => { const s = new Date(d + 'T12:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric' }); return s[0].toUpperCase() + s.slice(1); };
function vMov() {
  if (movAcc !== 'all' && !findMethod(movAcc)) movAcc = 'all';
  const accOn = movAcc !== 'all', cur = today().slice(0, 7);
  const tx = (accOn ? S.tx.filter(t => norm(t.method) === norm(movAcc)) : S.tx).filter(t => t.date.startsWith(month)).sort(byDate);
  const rows = accOn ? accRows(movAcc, d => d.startsWith(month)) : tx;   // en la vista de una cuenta también van sus traspasos
  const inc = sum(tx.filter(t => t.type === 'ingreso'), t => t.amount), exp = sum(tx.filter(t => t.type === 'gasto'), t => t.amount);
  const [y, m] = month.split('-').map(Number), dim = new Date(y, m, 0).getDate(), lead = (new Date(y, m - 1, 1).getDay() + 6) % 7, now = today();
  // neto de cada día = ingresos − gastos: rojo si se gastó más de lo que entró, verde si entró más; la intensidad sube con la diferencia
  const spend = {}, earn = {}; tx.forEach(t => { const o = t.type === 'gasto' ? spend : earn; o[t.date] = (o[t.date] || 0) + t.amount; });
  const days = [...new Set([...Object.keys(spend), ...Object.keys(earn)])], net = d => (earn[d] || 0) - (spend[d] || 0);
  const sv = Object.values(spend), nets = days.map(d => Math.abs(net(d))).filter(Boolean);
  const base = (sv.length ? sum(sv) / sv.length : 0) || (nets.length ? sum(nets) / nets.length : 1);
  const lvl = v => { const a = Math.abs(v); return a < base * .5 ? 1 : a < base ? 2 : a < base * 2.2 ? 3 : 4; };
  const sel = selDay && selDay.startsWith(month) ? selDay : now.startsWith(month) ? now : (days.sort().pop() || null);
  const k = v => (masking ? '••' : v >= 1000 ? Math.round(v / 1000) + 'k' : String(Math.round(v)));
  let cells = ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(w => `<div class="w" aria-hidden="true">${w}</div>`).join('') + '<div class="d v"></div>'.repeat(lead);
  for (let i = 1; i <= dim; i++) {
    const date = `${month}-${String(i).padStart(2, '0')}`, nt = net(date), has = nt !== 0, cls = ['d', has ? (nt > 0 ? 'g' : 'r') + lvl(nt) : 'l0', date > now ? 'f' : '', date === sel ? 'sel' : ''].join(' ');
    const said = (earn[date] || spend[date]) ? [earn[date] ? 'ingresó ' + money(earn[date]) : '', spend[date] ? 'gastó ' + money(spend[date]) : ''].filter(Boolean).join(', ') : 'sin movimientos';
    cells += `<button class="${cls}" data-act="day" data-d="${date}" aria-pressed="${date === sel}" aria-label="${dayLong(date)}: ${said}">${i}${has && date <= now ? `<small><b>${nt > 0 ? '+' : '−'}</b>${k(Math.abs(nt))}</small>` : ''}</button>`;
  }
  const dayTx = sel ? rows.filter(t => t.date === sel) : [], dayNet = sel ? net(sel) : 0;
  const list = rows.filter(t => movFilter === 'all' || (!t._m && (movFilter === 'gasto') === (t.type === 'gasto')));
  const balance = accOn ? accBalance(movAcc, month === cur ? now : month + '-31') : inc - exp;
  const accs = [...new Set([...allMethods().filter(accShown), ...(accOn ? [findMethod(movAcc)] : [])])];
  const chips = `<div class="chips2" role="group" aria-label="Ver por cuenta"><button class="${accOn ? '' : 'on'}" data-act="movacc" data-n="all" aria-pressed="${!accOn}">Todas</button>${accs.map(n => { const on = accOn && norm(movAcc) === norm(n); return `<button class="${on ? 'on' : ''}" data-act="movacc" data-n="${esc(n)}" aria-pressed="${on}"><i style="background:var(--c${METHOD_SLOT[n] || hashSlot(n)})"></i>${esc(n)}</button>`; }).join('')}</div>`;
  return `<button class="back" data-act="tab" data-v="home">‹ Inicio</button>` + monthNav() + chips
    + `<div class="card hero slim"><div class="pair"><div><span class="label">Entró</span><b class="pos">${money(inc)}</b></div><div><span class="label">Salió</span><b class="neg">${money(exp)}</b></div><div><span class="label">${accOn ? (month === cur ? 'Saldo hoy' : 'Saldo al cierre') : 'Quedó'}</span><b style="color:${balance < 0 ? 'var(--negx)' : 'var(--lime)'}">${money(balance)}</b></div></div></div>`
    + `<div class="cal">${cells}</div>`
    + `<div class="calkey"><span>gastaste más</span>${[4, 3, 2, 1].map(n => `<i style="background:var(--r${n})"></i>`).join('')}<i class="mid"></i>${[1, 2, 3, 4].map(n => `<i style="background:var(--g${n})"></i>`).join('')}<span>ingresó más</span></div>
      <div class="calnote">Cada día muestra <b>ingresos − gastos</b>, con su signo (cifras en miles). Sin movimientos: gris.${accOn ? ' Los traspasos entre cuentas no cuentan.' : ''}</div>`
    + (sel ? `<div class="dayc"><div class="dh"><span style="font:inherit">${dayLong(sel)}</span><span class="${dayNet > 0 ? 'pos' : dayNet < 0 ? 'neg' : 'muted'}">${dayNet ? (dayNet > 0 ? '+' : '−') + money(Math.abs(dayNet)) : 'Sin diferencia'}</span></div>${dayTx.length ? txList(dayTx, true) : '<div class="muted" style="padding:4px 0 12px;font-size:14px">Sin movimientos este día.</div>'}</div>` : '')
    + `<div class="fchips" role="group" aria-label="Filtrar movimientos">${[['all', 'Todo el mes'], ['gasto', 'Gastos'], ['ingreso', 'Ingresos']].map(([v, n]) => `<button class="${movFilter === v ? 'on' : ''}" data-act="movf" data-v="${v}" aria-pressed="${movFilter === v}">${n}</button>`).join('')}</div>`
    + `<div class="card" style="padding:6px 14px">${txList(list)}</div>`
    + `<div class="btns" style="margin-top:0"><button class="btn ghost sm ai-only" data-act="importmov">Importar desde captura o resumen</button></div>`;
}

// Deudas y cobros: una sola sección con dos vistas (personas / tarjetas y cuotas)
function vDeudas() {
  const seg = `<div class="seg" style="margin-bottom:14px">${[['people', 'Personas'], ['cards', 'Tarjetas y cuotas']].map(([v, n]) => `<label><input type="radio" name="dsub" value="${v}" ${debtsTab === v ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div>`;
  const add = debtsTab === 'people' ? ['newloan', '+ Préstamo o deuda con alguien'] : ['newdebt', '+ Nueva deuda o cuota'];
  return seg + (debtsTab === 'people' ? vPeople() : vDebts()) + `<div class="btns"><button class="btn" data-act="${add[0]}">${add[1]}</button></div>`;
}

function vDebts() {
  if (!S.debts.length) return `<div class="list">${empty('Sin deudas cargadas', 'Tarjeta, cuotas, préstamos: cargalos con el botón de abajo y seguí cuánto falta.')}</div>`;
  const tot = sum(S.debts, debtLeft);
  return `<div class="card"><div class="label">Total pendiente</div><div class="big neg">${money(tot)}</div>
    <div class="muted">Cuotas del mes: <b class="neg">${money(sum(S.debts.filter(d => d.cuotasPagas < d.cuotas), d => d.cuota))}</b></div></div>
  <div class="list">${S.debts.map(d => {
    const pct = Math.round(d.cuotasPagas / d.cuotas * 100), fin = d.cuotasPagas >= d.cuotas;
    return `<button class="item" data-act="debt" data-id="${d.id}" style="display:block"><div class="row"><div class="t">${esc(d.name)}</div><div class="amt ${fin ? '' : 'neg'}">${fin ? '<span class="pill pos">Pagada</span>' : money(debtLeft(d))}</div></div>
      <div class="s">${d.cuotasPagas}/${d.cuotas} cuotas de ${money(d.cuota)}${d.dueDay && !fin ? ' · vence el ' + d.dueDay : ''}</div><div class="bar"><i style="width:${pct}%"></i></div></button>`;
  }).join('')}</div>`;
}

function vPeople() {
  const ppl = peopleList();
  if (!ppl.length) return `<div class="list">${empty('Nadie te debe (ni le debés a nadie)', 'Prestaste plata o te prestaron: cargalo con el botón de abajo y mandá recordatorios por WhatsApp.')}</div>`;
  const row = p => `<button class="item" data-act="person" data-k="${esc(p.key)}"><div class="dot">${esc(p.name[0].toUpperCase())}</div>
    <div class="grow"><div class="t">${esc(p.name)}</div><div class="s">${p.net > 0 ? 'te debe' : p.net < 0 ? 'le debés' : 'en paz'}</div></div>
    <div class="amt ${p.net > 0 ? 'pos' : p.net < 0 ? 'neg' : 'muted'}">${money(Math.abs(p.net))}</div></button>`;
  const a = ppl.filter(p => p.net > 0), b = ppl.filter(p => p.net < 0), c = ppl.filter(p => p.net === 0);
  return (a.length ? `<h3>Te deben · ${money(sum(a, p => p.net))}</h3><div class="list">${a.map(row).join('')}</div>` : '')
    + (b.length ? `<h3>Les debés · ${money(-sum(b, p => p.net))}</h3><div class="list">${b.map(row).join('')}</div>` : '')
    + (c.length ? `<h3>Saldados</h3><div class="list">${c.map(row).join('')}</div>` : '');
}

// Dividir: calculadoras para una cuenta puntual
function vSplit() {
  return `<p class="muted" style="margin:0 0 14px">Para una cuenta puntual. Si es algo que se va acumulando (un viaje, el depto), usá <button class="link" data-act="tab" data-v="groups">Grupos</button>.</p>
  <div class="grid2 tiles">${[
    ['eq', 'Partes iguales', 'Con propina y redondeo'], ['who', 'Quién puso cuánto', 'Cada uno puso distinto'],
    ['fair', 'Por consumo', 'Cada uno paga lo suyo'], ['inc', 'Según ingresos', 'Proporcional al sueldo']
  ].map(([m, t, d]) => `<button class="card" data-act="calcmode" data-m="${m}"><b class="tile-t">${t}</b><span class="muted">${d}</span></button>`).join('')}</div>`;
}

function vGroups() {
  if (openGroup) {
    const g = S.groups.find(x => x.id === openGroup);
    if (!g) { openGroup = null; return vGroups(); }
    const bal = groupBalances(g), st = settle(bal), cons = groupConsumption(g), total = sum(g.expenses, e => e.amount);
    return `<button class="back" data-act="gback">‹ Grupos</button>
    <div class="card hero"><div class="label">${esc(g.name)} · gastado en total</div><div class="big neg">${money(total)}</div><div class="muted">${g.members.map(esc).join(', ')}</div></div>
    <div class="btns" style="margin:0 0 4px"><button class="btn" data-act="newitems">Compra por producto</button><button class="btn ghost" data-act="newgexp">+ Gasto simple</button></div>
    <h3>Cómo saldar</h3><div class="list">${st.length ? st.map(s => `<button class="item" data-act="gpay" data-from="${esc(s.from)}" data-to="${esc(s.to)}" data-amt="${Math.round(s.amount * 100) / 100}"><div class="grow"><b>${esc(s.from)}</b> le paga a <b>${esc(s.to)}</b><div class="s">Tocá para registrar el pago${s.to === 'Yo' ? ' o cobrar' : ''}</div></div><div class="amt">${money(s.amount)}</div></button>`).join('') : `<div class="item muted">${g.expenses.length ? 'Todo saldado' : 'Todavía no hay nada para saldar'}</div>`}</div>
    ${(g.payments || []).length ? `<h3>Pagos registrados</h3><div class="list">${g.payments.slice().sort(byDate).map(p => `<button class="item" data-act="gpaydel" data-id="${p.id}"><div class="grow"><b>${esc(p.from)}</b> le pagó a <b>${esc(p.to)}</b><div class="s">${dayLabel(p.date)} · tocá para deshacer</div></div><div class="amt pos">${money(p.amount)}</div></button>`).join('')}</div>` : ''}
    ${g.expenses.length ? `<h3>Quién consumió qué</h3><div class="list">${g.members.map(m => { const c = cons[m] || { consumed: 0, paid: 0 }, b = bal[m] || 0; return `<div class="item"><div class="grow"><b>${esc(m)}</b><div class="s">consumió ${money(c.consumed)} · puso ${money(c.paid)}</div></div><div class="amt ${b > 0.005 ? 'pos' : b < -0.005 ? 'neg' : 'muted'}">${b > 0.005 ? '+' : b < -0.005 ? '−' : ''}${money(Math.abs(b))}</div></div>`; }).join('')}</div>` : ''}
    <h3>Gastos</h3>${g.expenses.length ? `<div class="list">${g.expenses.slice().sort(byDate).map(e => `<button class="item" data-act="gexp" data-id="${e.id}"><div class="grow"><div class="t">${esc(e.desc)}</div><div class="s">Pagó ${esc(e.paidBy)} · ${dayLabel(e.date)} · ${e.items?.length ? e.items.length + (e.items.length === 1 ? ' producto' : ' productos') : e.split.length === g.members.length ? 'todos' : e.split.map(esc).join(', ')}</div></div><div class="amt neg">${money(e.amount)}</div></button>`).join('')}</div>` : `<div class="list">${empty('Sin gastos', 'Sumá el primero con el botón de arriba.')}</div>`}
    <div class="btns"><button class="btn danger sm" data-act="gdel">Eliminar grupo</button></div>`;
  }
  const newGroup = `<div class="btns"><button class="btn" data-act="newgroup">+ Nuevo grupo</button></div>`;
  if (!S.groups.length) return `<div class="list">${empty('Sin grupos', 'Armá uno para un viaje, el depto o una salida larga y llevá la cuenta entre todos.')}</div>` + newGroup;
  return `<div class="list">${S.groups.map(g => `<button class="item" data-act="group" data-id="${g.id}"><div class="dot">${stamp(g.name)}</div><div class="grow"><div class="t">${esc(g.name)}</div><div class="s">${g.members.length} personas · ${g.expenses.length} ${g.expenses.length === 1 ? 'gasto' : 'gastos'}</div></div><div class="amt neg">${money(sum(g.expenses, e => e.amount))}</div></button>`).join('')}</div>` + newGroup;
}

function render() {
  $('#title').textContent = openGroup && view === 'groups' ? 'Grupo' : TITLES[view];
  $('#sub').textContent = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#main').innerHTML = withMask({ home: vHome, mov: vMov, split: vSplit, groups: vGroups, debts: vDeudas }[view]);
  const tabOn = view === 'mov' ? 'home' : view;   // "Movimientos" cuelga de Inicio
  document.querySelectorAll('#tabs button[data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === tabOn));
  syncHistory();
}

// ---------- hoja modal ----------
// los campos de texto no deben ofrecer lo escrito antes (el navegador lo hace si no se le dice que no)
const noAutofill = root => root.querySelectorAll('input:not([autocomplete]):not([list]):not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file])').forEach(i => { i.setAttribute('autocomplete', 'off'); if (i.type === 'text') i.setAttribute('autocorrect', 'off'); });
function sheet(title, html) { $('#sheet-title').textContent = title; $('#sheet-body').innerHTML = html; noAutofill($('#sheet-body')); $('#overlay').hidden = false; $('#sheet-body').closest('.sheet').scrollTop = 0; syncHistory(); }
function closeSheet() { $('#overlay').hidden = true; $('#sheet-body').innerHTML = ''; syncHistory(); }

// ---------- botón / gesto "atrás" de Android ----------
// Cada capa abierta (sección ≠ Inicio, detalle de grupo, chat, ventana) suma una entrada al historial,
// así "atrás" cierra la capa de arriba en vez de sacar al usuario de la app. Desde Inicio, "atrás" sale.
let histDepth = 0, ignorePops = 0, syncT = 0;
const uiDepth = () => (view !== 'home' ? 1 : 0) + (openGroup && view === 'groups' ? 1 : 0) + ($('#overlay').hidden ? 0 : 1) + ($('#chat').hidden ? 0 : 1);
function syncHistory() {
  clearTimeout(syncT);
  syncT = setTimeout(() => {                         // diferido: si se cierra y reabre algo en el mismo instante, no hay cambio
    const d = uiDepth();
    if (d > histDepth) while (histDepth < d) history.pushState({ plata: ++histDepth }, '');
    else if (d < histDepth) { const n = histDepth - d; histDepth = d; ignorePops++; history.go(-n); }
  }, 0);
}
addEventListener('popstate', () => {
  if (ignorePops > 0) { ignorePops--; return; }
  histDepth = Math.max(0, histDepth - 1);            // el usuario volvió una entrada
  if (!$('#overlay').hidden) closeSheet();
  else if (!$('#chat').hidden) $('#chat').hidden = true;
  else if (openGroup && view === 'groups') { openGroup = null; render(); }
  else if (view !== 'home') { view = 'home'; render(); }
  syncHistory();
});
try { history.scrollRestoration = 'manual'; } catch { }
// devuelve false para que `return toast('...')` en un formulario cuente como "no se guardó"
function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2200); return false; }
const field = (label, input) => `<label>${label}${input}</label>`;
// categorías: las de fábrica + las que el usuario fue creando al escribirlas
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const allCats = type => [...CATS[type].map(c => c[0]), ...((S.customCats || {})[type] || [])];
const findCat = (type, name) => allCats(type).find(c => norm(c) === norm(name));
// devuelve la categoría existente o crea una nueva con el nombre dado
function ensureCat(type, raw) {
  raw = String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 30);
  if (!raw) return type === 'gasto' ? 'Otros' : 'Otros ingresos';
  let cat = findCat(type, raw);
  if (!cat) { cat = raw[0].toUpperCase() + raw.slice(1); ((S.customCats ||= { gasto: [], ingreso: [] })[type] ||= []).push(cat); }
  return cat;
}
// cuentas (dónde está la plata): Efectivo, Mercado Pago, bancos…; las de fábrica + las creadas + cualquier medio ya usado en un movimiento
const allMethods = () => [...METHODS, ...(S.customMethods || []), ...S.tx.map(t => t.method).filter(Boolean)].filter((m, i, a) => a.findIndex(x => norm(x) === norm(m)) === i);
const findMethod = name => allMethods().find(m => norm(m) === norm(name));
function ensureMethod(raw) {
  raw = String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 30);
  if (!raw) return 'Efectivo';
  let m = findMethod(raw);
  if (!m) { m = raw[0].toUpperCase() + raw.slice(1); (S.customMethods ||= []).push(m); }
  return m;
}
// saldo de una cuenta = saldo inicial + ingresos − gastos + traspasos que entraron − traspasos que salieron
function accBalance(name, upTo) {
  const k = norm(name), ok = d => !upTo || d <= upTo; let b = Number((S.accInit || {})[name]) || 0;
  for (const t of S.tx) if (norm(t.method) === k && ok(t.date)) b += t.type === 'ingreso' ? t.amount : -t.amount;
  for (const m of S.moves || []) if (ok(m.date)) { if (norm(m.from) === k) b -= m.amount; if (norm(m.to) === k) b += m.amount; }
  return Math.round(b * 100) / 100;
}
const accUsed = n => S.tx.some(t => norm(t.method) === norm(n)) || (S.moves || []).some(m => norm(m.from) === norm(n) || norm(m.to) === norm(n)) || !!Number((S.accInit || {})[n]);
function comboRender(input, showAll) {
  const acc = input.dataset.list === 'acc';
  const q = norm(input.value), cats = acc ? allMethods() : allCats(input.form.type.value), exact = cats.some(c => norm(c) === q);
  const shown = showAll || exact || !q ? cats : cats.filter(c => norm(c).includes(q)).sort((a, b) => (norm(b).startsWith(q) - norm(a).startsWith(q)));
  const raw = input.value.trim(), list = input.parentElement.querySelector('.combo-list');
  list.innerHTML = shown.map(c => `<button type="button" class="combo-opt" data-act="combopick" data-v="${esc(c)}">${esc(c)}</button>`).join('')
    + (q && !exact ? `<button type="button" class="combo-opt new" data-act="combopick" data-v="${esc(raw)}">+ Crear “${esc(raw)}”</button>` : '');
  list.hidden = !list.innerHTML;
}

function formTx(t, presetType) {
  const type = t?.type || presetType || 'gasto';
  sheet(t ? 'Editar movimiento' : 'Nuevo movimiento', `<form data-form="tx" data-id="${t?.id || ''}">
    ${t ? '' : `<button type="button" class="link ai-only" data-act="importmov" style="justify-self:start;text-align:left">¿Se te olvidaron varios? Importalos desde una captura o resumen</button>`}
    <div class="seg"><label><input type="radio" name="type" value="gasto" ${type === 'gasto' ? 'checked' : ''}><span>Gasto</span></label><label><input type="radio" name="type" value="ingreso" ${type === 'ingreso' ? 'checked' : ''}><span>Ingreso</span></label>${t ? '' : '<label><input type="radio" name="type" value="mover"><span>Mover</span></label>'}</div>
    ${field('Monto', MI(`<input class="money" name="amount" type="text" inputmode="decimal" placeholder="0" value="${t ? fmtIn(t.amount) : ''}" required autofocus>`, true))}
    <label>Categoría<div class="combo"><input type="text" name="cat" autocomplete="off" maxlength="30" placeholder="Elegí o escribí una nueva" role="combobox" aria-expanded="false" required>
      <button type="button" class="combo-btn" data-act="combotoggle" aria-label="Ver categorías">▾</button><div class="combo-list" hidden></div></div></label>
    ${accPicker('method', t?.method || S.lastMethod || 'Efectivo', type === 'gasto' ? 'Pagué con' : 'Me ingresó por', 'method-label')}
    ${field('Nota (opcional)', `<input type="text" name="note" value="${esc(t?.note || '')}" placeholder="Ej: súper, nafta…">`)}
    ${field('Fecha', `<input type="date" name="date" value="${t?.date || today()}" required>`)}
    <button class="btn block">Guardar</button>
    ${t ? `<button type="button" class="btn danger block" data-act="txdel" data-id="${t.id}">Eliminar</button>` : ''}
  </form>`);
  const f = $('form[data-form=tx]');
  const fill = () => { const ty = f.type.value; f.cat.value = t && t.type === ty ? t.cat : allCats(ty)[0]; f.querySelectorAll('.combo-list').forEach(l => l.hidden = true); $('#method-label').textContent = ty === 'gasto' ? 'Pagué con' : 'Me ingresó por'; accEffects(f); };
  f.querySelectorAll('[name=type]').forEach(r => r.onchange = () => r.value === 'mover' ? formMove() : fill()); fill();
}
// Mover plata: de una cuenta a otra (retirar del cajero, cargar Mercado Pago, pagar la tarjeta). No es gasto ni ingreso.
// lista de cuentas con saldo: círculo de selección, nombre, saldo y, a la derecha, cómo queda la cuenta al guardar; "Nueva cuenta" permite escribir una que no está
function accPicker(name, sel, label, labelId) {
  const all = allMethods(), top = all.filter(n => accShown(n) || norm(n) === norm(sel)), rest = all.filter(n => !top.includes(n));
  const row = n => { const on = norm(n) === norm(sel); return `<button type="button" class="rc${on ? ' on' : ''}" role="radio" aria-checked="${on}" data-act="accpick" data-f="${name}" data-n="${esc(n)}"><span class="rb"></span><span><b>${esc(n)}</b><small>Saldo ${money(accBalance(n))}</small></span><span class="am"></span></button>`; };
  const restOpen = rest.some(n => norm(n) === norm(sel));
  return `<div class="pk"><div class="label"${labelId ? ` id="${labelId}"` : ''}>${label}</div>
    <div class="rcards" role="radiogroup" aria-label="${esc(label)}" data-f="${name}">${top.map(row).join('')}${rest.length ? `<button type="button" class="rc more" data-act="accmore" aria-expanded="${restOpen}"><span></span><span>Otros medios ${restOpen ? '▴' : '▾'}</span></button><div class="rcmore"${restOpen ? '' : ' hidden'}>${rest.map(row).join('')}</div>` : ''}
      <div class="rc add"><span class="rb plus">+</span><button type="button" class="newbtn" data-act="accnew" data-f="${name}">Nueva cuenta</button><input type="text" class="newin" data-f="${name}" maxlength="30" placeholder="Nombre de la cuenta nueva" aria-label="Nombre de la cuenta nueva" hidden></div></div>
    <input type="hidden" name="${name}" value="${esc(sel)}"></div>`;
}
// muestra a la derecha de la cuenta elegida cuánto le quedaría
function accEffects(f) {
  if (!f || !f.amount) return;
  const amt = parseAmount(f.amount.value) || 0, edit = f.dataset.form === 'tx' && f.dataset.id;
  const delta = { method: f.dataset.form === 'tx' && f.type ? (f.type.value === 'gasto' ? -amt : amt) : 0, from: -amt, to: amt };
  f.querySelectorAll('.rcards').forEach(g => g.querySelectorAll('.rc[data-n]').forEach(r => {
    const am = r.querySelector('.am'), d = delta[g.dataset.f];
    if (r.classList.contains('on') && amt > 0 && !edit) { am.textContent = money(accBalance(r.dataset.n) + d); am.className = 'am ' + (d < 0 ? 'neg' : 'pos'); } else { am.textContent = ''; am.className = 'am'; }
  }));
}
// en Mover plata, la cuenta de origen no puede ser también el destino
function syncMove(f) {
  f.querySelectorAll('.rcards[data-f=to] .rc[data-n]').forEach(r => {
    const same = norm(r.dataset.n) === norm(f.from.value); r.disabled = same;
    if (same && r.classList.contains('on')) { r.classList.remove('on'); r.setAttribute('aria-checked', 'false'); f.to.value = ''; }
  });
}
function formMove(from, to) {
  from = from || S.lastMethod || 'Efectivo';
  to = to || allMethods().find(a => norm(a) !== norm(from)) || '';
  sheet('Mover plata', `<form data-form="move">
    <div class="seg"><label><input type="radio" name="type" value="gasto"><span>Gasto</span></label><label><input type="radio" name="type" value="ingreso"><span>Ingreso</span></label><label><input type="radio" name="type" value="mover" checked><span>Mover</span></label></div>
    <p class="muted" style="margin:0;font-size:14px">Pasá plata de una cuenta a otra: sacar del cajero, cargar Mercado Pago, pagar la tarjeta. No cuenta como gasto ni como ingreso.</p>
    ${accPicker('from', from, 'Desde')}${accPicker('to', to, 'Hasta')}
    ${field('Monto', MI(`<input class="money" name="amount" type="text" inputmode="decimal" placeholder="0" required autofocus>`, true))}
    ${field('Fecha', `<input type="date" name="date" value="${today()}" required>`)}
    <button class="btn block">Mover plata</button></form>`);
  const f = $('form[data-form=move]');
  f.querySelectorAll('[name=type]').forEach(r => r.onchange = () => { if (r.value !== 'mover') formTx(null, r.value); });
  syncMove(f); accEffects(f);
}
const accDot = n => { const k = METHOD_SLOT[n] || hashSlot(n); return `<div class="dot${k === 5 ? ' d5' : ''}" style="background:var(--c${k})">${stamp(n)}</div>`; };
// resumen de una cuenta (hoja): saldo, cambio del mes, entró / salió / traspasos, en qué se va y los últimos movimientos
function sheetAccSummary(n) {
  const now = new Date(), cur = today().slice(0, 7), k = norm(n), pe = new Date(now.getFullYear(), now.getMonth(), 0);
  const prevEnd = `${pe.getFullYear()}-${String(pe.getMonth() + 1).padStart(2, '0')}-${String(pe.getDate()).padStart(2, '0')}`;
  const mine = S.tx.filter(t => norm(t.method) === k && t.date.startsWith(cur)), mv = (S.moves || []).filter(m => m.date.startsWith(cur));
  const ent = sum(mine.filter(t => t.type === 'ingreso'), t => t.amount), sal = sum(mine.filter(t => t.type === 'gasto'), t => t.amount);
  const tra = sum(mv.filter(m => norm(m.to) === k), m => m.amount) - sum(mv.filter(m => norm(m.from) === k), m => m.amount);
  const hoy = accBalance(n), chg = Math.round((hoy - accBalance(n, prevEnd)) * 100) / 100;
  const byCat = {}; mine.filter(t => t.type === 'gasto').forEach(t => { byCat[t.cat] = (byCat[t.cat] || 0) + t.amount; });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]), top = cats.slice(0, 3), rest = sum(cats.slice(3), c => c[1]);
  const slots = assignSlots(top.map(c => c[0]), c => CAT_SLOT[c] || hashSlot(c)), rows = top.map(([c, v]) => ({ c, v, s: slots[c] || 6 }));
  if (rest > 0) rows.push({ c: 'Otras', v: rest, s: 6 });
  sheet(n, withMask(() => {
    const tiles = [['Entró', money(ent), 'pos'], ['Salió', money(sal), 'neg']].concat(tra ? [['Traspasos', (tra > 0 ? '+' : '−') + money(Math.abs(tra)), '']] : []);
    const long = tiles.some(t => t[1].length > (tiles.length > 2 ? 9 : 13));   // con cifras largas las tres tarjetas pasan a una lista
    const stats = long ? `<div class="mini3 stack">${tiles.map(t => `<div><small>${t[0]}</small><b class="${t[2]}">${t[1]}</b></div>`).join('')}</div>` : `<div class="mini3" style="grid-template-columns:repeat(${tiles.length},minmax(0,1fr))">${tiles.map(t => `<div><small>${t[0]}</small><b class="${t[2]}">${t[1]}</b></div>`).join('')}</div>`;
    const ribbon = sal > 0 ? `<div class="rib" role="img" aria-label="En qué se va">${rows.map(r => `<i style="flex:${r.v};background:var(--c${r.s})"></i>`).join('')}</div><div class="calnote" style="margin:0 0 4px">${rows.map(r => esc(r.c) + ' ' + Math.round(r.v / sal * 100) + '%').join(' · ')} de lo que salió</div>` : '';
    const list = accRows(n, () => true).slice(0, 3);
    return `<div class="big ${hoy < 0 ? 'neg' : ''} ${bigCls(money(hoy))}" style="margin:0 0 2px">${money(hoy)}</div>
    <div class="s" style="margin:0 0 12px;color:var(--muted);font-size:14px"><b class="${chg < 0 ? 'neg' : 'pos'}">${chg < 0 ? '▼' : '▲'} ${money(Math.abs(chg))}</b> este mes</div>
    ${stats}${ribbon}
    ${list.length ? `<div class="list">${txList(list)}</div>` : '<p class="muted" style="font-size:14px">Todavía no hay movimientos en esta cuenta.</p>'}
    <div class="acts"><button class="btn ghost" data-act="accgo" data-n="${esc(n)}">Ver por mes</button><button class="btn" data-act="moveform" data-from="${esc(n)}">Mover plata</button></div>`;
  }));
}
function sheetAccounts() {
  const rows = allMethods().filter(accShown).map(n => { const b = accBalance(n); return `<button class="item" data-act="acc" data-n="${esc(n)}">${accDot(n)}<div class="grow"><div class="t">${esc(n)}</div>${accUsed(n) ? '' : '<div class="s">Sin movimientos todavía</div>'}</div><div class="amt ${b > 0 ? 'pos' : b < 0 ? 'neg' : 'muted'}">${money(b)}</div></button>`; }).join('');
  const moves = (S.moves || []).slice().sort(byDate).slice(0, 6).map(m => `<button class="item" data-act="movedel" data-id="${m.id}"><div class="grow"><div class="t">${esc(m.from)} → ${esc(m.to)}</div><div class="s">${dayLabel(m.date)} · tocá para deshacer</div></div><div class="amt">${money(m.amount)}</div></button>`).join('');
  sheet('Mis cuentas', `<p class="muted" style="margin:0;font-size:14px">Cada gasto o ingreso suma o resta de la cuenta que elijas al anotarlo. Un saldo negativo es plata que debés (por ejemplo, la tarjeta).</p>
    <div class="list">${rows}</div>
    <div class="btns"><button class="btn" data-act="moveform">Mover plata</button><button class="btn ghost" data-act="newacc">+ Nueva cuenta</button></div>
    ${moves ? `<h3>Últimos traspasos</h3><div class="list">${moves}</div>` : ''}`);
}
function sheetAcc(n) {
  const k = norm(n), init = Number((S.accInit || {})[n]) || 0, mine = S.tx.filter(t => norm(t.method) === k), mv = S.moves || [];
  const inc = sum(mine.filter(t => t.type === 'ingreso'), t => t.amount), exp = sum(mine.filter(t => t.type === 'gasto'), t => t.amount);
  const mi = sum(mv.filter(m => norm(m.to) === k), m => m.amount), mo = sum(mv.filter(m => norm(m.from) === k), m => m.amount), b = accBalance(n);
  const line = (l, v, c = '') => `<div class="row" style="padding:5px 0;border-top:1px solid var(--line)"><span class="muted">${l}</span><b class="${c}">${v}</b></div>`;
  const canDel = (S.customMethods || []).some(c => norm(c) === k) && !S.tx.some(t => norm(t.method) === k) && !mv.some(m => norm(m.from) === k || norm(m.to) === k);
  sheet(n, `<div class="card"><div class="label">Saldo</div><div class="big ${b < 0 ? 'neg' : ''}">${money(b)}</div>
    ${line('Saldo inicial', money(init))}${line('Ingresos', '+' + money(inc), 'pos')}${line('Gastos', '−' + money(exp), 'neg')}${line('Traspasos que entraron', '+' + money(mi))}${line('Traspasos que salieron', '−' + money(mo))}</div>
    <form data-form="accinit" data-n="${esc(n)}">${field('Saldo inicial (lo que tenías antes de usar la app)', MI(`<input class="money i-amt" name="init" type="text" inputmode="decimal" placeholder="0" value="${init ? fmtIn(init) : ''}">`, true))}
    <button class="btn block">Guardar saldo inicial</button></form>
    <div class="btns"><button class="btn ghost" data-act="moveform" data-from="${esc(n)}">Mover plata desde acá</button>${canDel ? `<button class="btn danger" data-act="accdel" data-n="${esc(n)}">Eliminar cuenta</button>` : ''}</div>`);
}
function formNewAcc() {
  sheet('Nueva cuenta', `<form data-form="newacc">
    ${field('Nombre', `<input type="text" name="name" maxlength="30" placeholder="Ej: Banco Galicia, Ualá, ahorros" required autofocus>`)}
    ${field('Saldo inicial (opcional)', MI(`<input class="money i-amt" name="init" type="text" inputmode="decimal" placeholder="0">`, true))}
    <button class="btn block">Crear cuenta</button></form>`);
}
function formDebt(d) {
  sheet(d ? 'Editar deuda' : 'Nueva deuda', `<form data-form="debt" data-id="${d?.id || ''}">
    ${field('Nombre', `<input type="text" name="name" value="${esc(d?.name || '')}" placeholder="Ej: Visa, préstamo auto" required autofocus>`)}
    ${field('Monto total', MI(`<input class="money" name="total" type="text" inputmode="decimal" placeholder="0" value="${d ? fmtIn(d.cuota * d.cuotas) : ''}" required>`, true))}
    <div class="grid2" style="margin:0">${field('Cuotas', `<input type="number" name="cuotas" min="1" value="${d?.cuotas || 1}" required>`)}
    ${field('Ya pagadas', `<input type="number" name="paid" min="0" value="${d?.cuotasPagas || 0}">`)}</div>
    ${field('Día de vencimiento (opcional)', `<input type="number" name="dueDay" min="1" max="31" value="${d?.dueDay || ''}" placeholder="1–31">`)}
    <button class="btn block">Guardar</button></form>`);
}
function formLoan(dir = 'me-deben') {
  sheet('Plata con personas', `<form data-form="loan">
    <div class="seg"><label><input type="radio" name="dir" value="me-deben" ${dir === 'me-deben' ? 'checked' : ''}><span>Me debe</span></label><label><input type="radio" name="dir" value="debo" ${dir === 'debo' ? 'checked' : ''}><span>Le debo</span></label></div>
    ${field('Persona', `<input type="text" name="person" list="ppl" required autofocus placeholder="Nombre">`)}<datalist id="ppl">${peopleList().map(p => `<option value="${esc(p.name)}">`).join('')}</datalist>
    ${field('Monto', MI(`<input class="money" name="amount" type="text" inputmode="decimal" placeholder="0" required>`, true))}
    ${field('Concepto (opcional)', `<input type="text" name="concept" placeholder="Ej: entradas, cena">`)}
    ${field('WhatsApp (opcional, con código de país)', `<input type="tel" name="phone" placeholder="5491122334455">`)}
    ${field('Fecha', `<input type="date" name="date" value="${today()}">`)}
    <button class="btn block">Guardar</button></form>`);
}
function formGroup() {
  sheet('Nuevo grupo', `<form data-form="group">
    ${field('Nombre', `<input type="text" name="name" placeholder="Ej: Viaje a Mar del Plata" required autofocus>`)}
    ${field('Integrantes (separados por coma)', `<input type="text" name="members" placeholder="Ana, Pedro, Lu" required>`)}
    <div class="muted" style="font-size:13px">Vos entrás automáticamente como “Yo”.</div>
    <button class="btn block">Crear grupo</button></form>`);
}
function formGexp(g, e) {
  sheet(e ? 'Editar gasto' : 'Gasto del grupo', `<form data-form="gexp" data-id="${e?.id || ''}">
    ${field('Qué fue', `<input type="text" name="desc" value="${esc(e?.desc || '')}" required autofocus placeholder="Ej: cena, nafta">`)}
    ${field('Monto', MI(`<input class="money" name="amount" type="text" inputmode="decimal" placeholder="0" value="${fmtIn(e?.amount)}" required>`, true))}
    ${field('Pagó', `<select name="paidBy">${g.members.map(m => `<option ${m === (e?.paidBy || 'Yo') ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>`)}
    <label>Se divide entre<div class="checks">${g.members.map(m => `<label><input type="checkbox" name="split" value="${esc(m)}" ${!e || e.split.includes(m) ? 'checked' : ''}>${esc(m)}</label>`).join('')}</div></label>
    ${field('Fecha', `<input type="date" name="date" value="${e?.date || today()}">`)}
    <button class="btn block">Guardar</button>
    ${e ? `<button type="button" class="btn danger block" data-act="gexpdel" data-id="${e.id}">Eliminar</button>` : ''}</form>`);
}
// Registrar el pago de una transferencia sugerida; si cobrás vos, arma el mensaje con tu alias; si pagás vos, guarda el alias de quien cobra
function sheetPay(g, from, to, amt) {
  const mine = S.me?.alias || '', theirs = g.aliases?.[to] || '';
  sheet('Registrar pago', `<form data-form="gpay"><input type="hidden" name="from" value="${esc(from)}"><input type="hidden" name="to" value="${esc(to)}">
    <div class="card" style="margin:0"><div class="label">${esc(from)} → ${esc(to)}</div><div class="muted" style="font-size:13px">Faltan ${money(amt)} para saldar esta deuda</div></div>
    ${field('Monto pagado', MI(`<input class="money" name="amount" type="text" inputmode="decimal" value="${fmtIn(amt)}" required>`, true))}
    ${field('Fecha', `<input type="date" name="date" value="${today()}">`)}
    ${to === 'Yo' ? field('Tu alias o CBU, para cobrar', `<input type="text" name="alias" value="${esc(mine)}" placeholder="mi.alias.mp" autocomplete="off" autocapitalize="off">`) + `<button type="button" class="btn ghost block" data-act="gcobrar">Cobrar por WhatsApp</button>` : ''}
    ${from === 'Yo' ? field(`Alias o CBU de ${esc(to)} (opcional)`, `<input type="text" name="alias" value="${esc(theirs)}" placeholder="su.alias" autocomplete="off" autocapitalize="off">`) + `<button type="button" class="btn ghost block" data-act="gcopy">Copiar alias</button>` : ''}
    <button class="btn block">Registrar pago</button></form>`);
}
function sheetDebt(d) {
  const fin = d.cuotasPagas >= d.cuotas;
  sheet(d.name, `<div class="card"><div class="label">Falta pagar</div><div class="big neg">${money(debtLeft(d))}</div>
    <div class="muted">${d.cuotasPagas}/${d.cuotas} cuotas de ${money(d.cuota)}</div><div class="bar"><i style="width:${Math.round(d.cuotasPagas / d.cuotas * 100)}%"></i></div></div>
    <div class="btns">${fin ? '' : `<button class="btn" data-act="payquota" data-id="${d.id}">Pagar cuota (${money(d.cuota)})</button>`}
    <button class="btn ghost" data-act="debtedit" data-id="${d.id}">Editar</button><button class="btn danger" data-act="debtdel" data-id="${d.id}">Eliminar</button></div>
    ${fin ? '' : '<p class="muted" style="font-size:13px">Al pagar una cuota se suma también como gasto en “Deudas”.</p>'}`);
}
function sheetPerson(k) {
  const loans = S.loans.filter(l => personKey(l) === k);
  if (!loans.length) return closeSheet();
  const p = peopleList().find(x => x.key === k), name = personName(loans[0]);
  const lines = loans.slice().sort((a, b) => b.date.localeCompare(a.date)).map(l => `
    <div class="item" style="display:block"><div class="row"><div class="t">${esc(l.concept || (l.dir === 'me-deben' ? 'Préstamo' : 'Deuda'))}</div><div class="amt ${l.dir === 'me-deben' ? 'pos' : 'neg'}">${money(loanLeft(l))}</div></div>
    <div class="s">${l.dir === 'me-deben' ? 'Te debe' : 'Le debés'} · ${dayLabel(l.date)} · total ${money(l.amount)}${(l.payments || []).length ? ' · pagado ' + money(loanPaid(l)) : ''}</div>
    <div class="btns">${loanLeft(l) > 0 ? `<button class="btn sm" data-act="loanpay" data-id="${l.id}">Registrar pago</button>` : '<span class="pill pos">Saldado</span>'}<button class="btn sm danger" data-act="loandel" data-id="${l.id}">Borrar</button></div></div>`).join('');
  sheet(name, `<div class="card"><div class="label">${p.net > 0 ? 'Te debe' : p.net < 0 ? 'Le debés' : 'Saldado'}</div><div class="big ${p.net > 0 ? 'pos' : p.net < 0 ? 'neg' : ''}">${money(Math.abs(p.net))}</div>
    ${p.net > 0 ? `<button class="btn" data-act="remind" data-k="${esc(k)}">Recordar por WhatsApp</button>` : ''}</div><div class="list">${lines}</div>`);
}

// ---------- acciones ----------
const act = {
  tab: el => { view = el.dataset.v; if (el.dataset.sub) debtsTab = el.dataset.sub; openGroup = null; render(); $('#scroll').scrollTo({ top: 0, behavior: 'instant' }); },
  mprev: () => { month = shiftMonth(month, -1); selDay = null; render(); },
  mnext: () => { month = shiftMonth(month, 1); selDay = null; render(); },
  // cambios dentro de la misma pantalla: no reanimar ni mover el scroll
  hseg: el => { homeSeg = el.dataset.v; swapBreakdown(); },
  day: el => keepView(() => { selDay = el.dataset.d; }),
  movf: el => keepView(() => { movFilter = el.dataset.v; }),
  accpick: el => {
    const f = el.closest('form'), g = el.closest('.rcards');
    f[el.dataset.f].value = el.dataset.n;
    g.querySelectorAll('.rc[data-n]').forEach(r => { r.classList.toggle('on', r === el); r.setAttribute('aria-checked', r === el); });
    const add = g.querySelector('.rc.add'); add.classList.remove('on'); add.querySelector('.newin').hidden = true; add.querySelector('.newbtn').hidden = false;
    if (f.dataset.form === 'move') syncMove(f);
    accEffects(f);
  },
  accmore: el => { const box = el.nextElementSibling; box.hidden = !box.hidden; el.setAttribute('aria-expanded', !box.hidden); el.lastElementChild.textContent = 'Otros medios ' + (box.hidden ? '▾' : '▴'); },
  accnew: el => {
    const f = el.closest('form'), add = el.closest('.rc.add'), i = add.querySelector('.newin');
    el.closest('.rcards').querySelectorAll('.rc[data-n]').forEach(r => { r.classList.remove('on'); r.setAttribute('aria-checked', 'false'); });
    f[el.dataset.f].value = ''; el.hidden = true; i.hidden = false; add.classList.add('on'); i.focus();
    if (f.dataset.form === 'move') syncMove(f);
    accEffects(f);
  },
  hide: () => keepView(() => { HIDE = !HIDE; prefSet('plata.hide', HIDE); }),
  hdet: el => { const box = el.nextElementSibling; box.hidden = !box.hidden; homeDet = !box.hidden; prefSet('plata.det', homeDet); el.setAttribute('aria-expanded', homeDet); el.querySelector('span').textContent = homeDet ? 'Detalle ▴' : 'Ver detalle ▾'; },
  // tocar una cuenta del detalle abre Por mes mirando solo esa cuenta
  accsum: el => sheetAccSummary(el.dataset.n),
  accgo: el => { movAcc = el.dataset.n; month = today().slice(0, 7); selDay = null; movFilter = 'all'; view = 'mov'; openGroup = null; closeSheet(); render(); $('#scroll').scrollTo({ top: 0, behavior: 'instant' }); },
  movacc: el => { keepView(() => { movAcc = el.dataset.n; }); $('.chips2 .on')?.scrollIntoView({ inline: 'center', block: 'nearest' }); },
  mvundo: el => { if (confirm('¿Deshacer este traspaso? Cada cuenta vuelve a su saldo anterior.')) { S.moves = (S.moves || []).filter(m => m.id !== el.dataset.id); commit(); } },
  close: closeSheet,
  addtx: () => formTx(),
  newloan: () => formLoan(),
  newdebt: () => formDebt(),
  newgroup: () => formGroup(),
  newgexp: () => formGexp(S.groups.find(g => g.id === openGroup)),
  tx: el => formTx(S.tx.find(t => t.id === el.dataset.id)),
  txdel: el => { if (confirm('¿Eliminar este movimiento?')) { S.tx = S.tx.filter(t => t.id !== el.dataset.id); closeSheet(); commit(); } },
  debt: el => sheetDebt(S.debts.find(d => d.id === el.dataset.id)),
  debtedit: el => formDebt(S.debts.find(d => d.id === el.dataset.id)),
  debtdel: el => { if (confirm('¿Eliminar esta deuda?')) { S.debts = S.debts.filter(d => d.id !== el.dataset.id); closeSheet(); commit(); } },
  payquota: el => {
    const d = S.debts.find(x => x.id === el.dataset.id); if (!d || d.cuotasPagas >= d.cuotas) return;
    d.cuotasPagas++; S.tx.push({ id: uid(), type: 'gasto', amount: d.cuota, cat: 'Deudas', note: `${d.name} · cuota ${d.cuotasPagas}/${d.cuotas}`, date: today() });
    commit(); sheetDebt(d); toast('Cuota registrada');
  },
  person: el => sheetPerson(el.dataset.k),
  loanpay: el => {
    const l = S.loans.find(x => x.id === el.dataset.id);
    sheet('Registrar pago', `<form data-form="loanpay" data-id="${l.id}">${field(`Monto (resta ${money(loanLeft(l))})`, MI(`<input class="money" name="amount" type="text" inputmode="decimal" value="${fmtIn(loanLeft(l))}" required autofocus>`, true))}
      ${field('Fecha', `<input type="date" name="date" value="${today()}">`)}<button class="btn block">Guardar</button></form>`);
  },
  loandel: el => { if (confirm('¿Borrar este registro?')) { const k = personKey(S.loans.find(l => l.id === el.dataset.id) || {}); S.loans = S.loans.filter(l => l.id !== el.dataset.id); commit(); sheetPerson(k); } },
  remind: el => {
    const k = el.dataset.k, loans = S.loans.filter(l => personKey(l) === k && l.dir === 'me-deben' && loanLeft(l) > 0);
    const p = peopleList().find(x => x.key === k), total = sum(loans, loanLeft), first = p.name.split(' ')[0];
    const concept = loans.length === 1 && loans[0].concept ? ` de ${loans[0].concept}` : '';
    const msg = `Hola ${first}! Te escribo por los ${money(total)}${concept} que quedaron pendientes.${S.me?.alias ? ` Podés pasármelo al alias ${S.me.alias}.` : ''} Cuando puedas me avisás, gracias!`;
    window.open(`https://wa.me/${(p.phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
  },
  gpay: el => sheetPay(S.groups.find(g => g.id === openGroup), el.dataset.from, el.dataset.to, +el.dataset.amt),
  gpaydel: el => { if (confirm('¿Deshacer este pago? Vuelve a aparecer como pendiente.')) { const g = S.groups.find(x => x.id === openGroup); g.payments = (g.payments || []).filter(p => p.id !== el.dataset.id); commit(); } },
  gcopy: () => {
    const a = $('form[data-form=gpay] [name=alias]')?.value.trim(); if (!a) return toast('Primero escribí el alias');
    (navigator.clipboard?.writeText(a) || Promise.reject()).then(() => toast('Alias copiado'), () => toast('No pude copiar. Mantené apretado el texto para copiarlo.'));
  },
  gcobrar: () => {
    const f = $('form[data-form=gpay]'), g = S.groups.find(x => x.id === openGroup), alias = f.alias.value.trim(), amt = parseAmount(f.amount.value);
    if (!alias) return toast('Escribí tu alias para poder cobrar');
    (S.me ||= {}).alias = alias; save();
    const msg = `Hola ${f.from.value.split(' ')[0]}! Quedamos en ${money(amt)} por "${g.name}". Pasámelo al alias ${alias}. Gracias!`;
    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank', 'noopener');
  },
  group: el => { openGroup = el.dataset.id; render(); $('#scroll').scrollTo({ top: 0, behavior: 'instant' }); },
  gback: () => { openGroup = null; render(); },
  gdel: () => { if (confirm('¿Eliminar el grupo y todos sus gastos?')) { S.groups = S.groups.filter(g => g.id !== openGroup); openGroup = null; commit(); } },
  gexp: el => { const g = S.groups.find(x => x.id === openGroup), e = g.expenses.find(x => x.id === el.dataset.id); e.items ? formItems(g, e) : formGexp(g, e); },
  gexpdel: el => { const g = S.groups.find(x => x.id === openGroup); g.expenses = g.expenses.filter(e => e.id !== el.dataset.id); closeSheet(); commit(); },
  install: async () => { if (!installEv) return; installEv.prompt(); try { await installEv.userChoice; } catch { } installEv = null; closeSheet(); },
  reload: () => location.reload(),
  checkupdate: async () => {
    const el = $('#app-ver'); if (el) el.textContent = 'Buscando actualización…';
    try { const reg = await navigator.serviceWorker.getRegistration(); await reg?.update(); } catch { }
    setTimeout(showVersion, 1500);
  },
  settings: () => { sheet('Ajustes y backup', `
    ${installEv && !matchMedia('(display-mode: standalone)').matches ? '<button class="btn block" data-act="install">Instalar app en este teléfono</button>' : ''}
    <label>Tema<div class="seg">${[['light', 'Claro'], ['dark', 'Oscuro']].map(([v, n]) => `<label><input type="radio" name="theme" value="${v}" ${getTheme() === v ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div></label>
    ${/SamsungBrowser/.test(navigator.userAgent) ? '<p class="muted" style="font-size:13px;margin:0">Estás usando Samsung Internet. Si el tema Claro se ve oscuro, es el modo oscuro de ese navegador: apagalo para sitios web en sus ajustes (☰ → Ajustes → Apariencia, o Labs), o instalá Plata desde Chrome.</p>' : ''}
    <h3>Cuentas</h3>
    <div class="card" style="padding:2px 14px"><button class="item" data-act="accounts"><div class="grow"><div class="t">Mis cuentas y saldos</div><div class="s">Saldo inicial de cada cuenta, traspasos y cuentas nuevas</div></div><span class="ch" aria-hidden="true">›</span></button></div>
    <h3>Funciones con IA</h3>
    <div class="card" style="padding:2px 14px"><button class="item" data-act="cfg"><div class="grow"><div class="t">Configurar la IA</div><div class="s">Opcional: asistente, escanear tickets e importar movimientos</div></div><span class="ch" aria-hidden="true">›</span></button></div>
    <h3>Para cobrar</h3>
    <label>Mi alias o CBU, para cobrar por WhatsApp<input type="text" id="me-alias" value="${esc(S.me?.alias || '')}" placeholder="mi.alias.mp" autocomplete="off" autocapitalize="off"></label>
    <h3>Tus datos</h3>
    <p class="muted" style="margin:0">Viven solo en este dispositivo. Hacé backups seguido, sobre todo antes de cambiar de celular.</p>
    <div class="btns"><button class="btn" data-act="export">Exportar backup</button>
    <label class="btn ghost" style="cursor:pointer">Importar backup<input type="file" accept="application/json" id="imp" hidden></label>
    <button class="btn danger" data-act="wipe">Borrar todo</button></div>
    <div class="row" style="margin-top:6px"><span id="app-ver" class="muted" style="font-size:13px"></span><button class="btn ghost sm" data-act="checkupdate">Buscar actualización</button></div>`); showVersion(); },
  export: () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }));
    a.download = `plata-backup-${today()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1e3);
  },
  accounts: sheetAccounts,
  acc: el => sheetAcc(el.dataset.n),
  newacc: formNewAcc,
  moveform: el => formMove(el.dataset.from),
  movedel: el => { if (confirm('¿Deshacer este traspaso? Cada cuenta vuelve a su saldo anterior.')) { S.moves = (S.moves || []).filter(m => m.id !== el.dataset.id); commit(); sheetAccounts(); } },
  accdel: el => { if (confirm('¿Eliminar esta cuenta?')) { const n = el.dataset.n; S.customMethods = (S.customMethods || []).filter(c => c !== n); if (S.accInit) delete S.accInit[n]; commit(); sheetAccounts(); } },
  wipe: () => { if (confirm('Esto borra TODOS tus datos de este dispositivo. ¿Seguro?') && confirm('Última chance: ¿borrar todo?')) { S = { tx: [], debts: [], loans: [], groups: [] }; closeSheet(); commit(); } }
};

const forms = {
  move(f) {
    const amount = parseAmount(f.amount.value); if (!(amount > 0)) return toast('Monto inválido');
    const from = f.from.value.trim(), to = f.to.value.trim();
    if (!from || !to) return toast('Elegí desde qué cuenta y hacia cuál');
    if (norm(from) === norm(to)) return toast('Elegí dos cuentas distintas');
    (S.moves ||= []).push({ id: uid(), from: ensureMethod(from), to: ensureMethod(to), amount: Math.round(amount * 100) / 100, date: f.date.value || today() });
  },
  accinit(f) {
    const v = f.init.value.trim() ? parseAmount(f.init.value) : 0; if (isNaN(v)) return toast('Monto inválido');
    (S.accInit ||= {})[f.dataset.n] = Math.round(v * 100) / 100;
    commit(); sheetAcc(f.dataset.n); toast('Guardado'); return 'done';
  },
  newacc(f) {
    const name = f.name.value.trim(); if (!name) return toast('Poné un nombre');
    if (findMethod(name)) return toast('Esa cuenta ya existe');
    const v = f.init.value.trim() ? parseAmount(f.init.value) : 0; if (isNaN(v)) return toast('Monto inválido');
    const n = ensureMethod(name); if (v) (S.accInit ||= {})[n] = Math.round(v * 100) / 100;
    commit(); sheetAccounts(); toast('Cuenta creada'); return 'done';
  },
  gpay(f) {
    const g = S.groups.find(x => x.id === openGroup), amount = parseAmount(f.amount.value);
    if (!(amount > 0)) return toast('Monto inválido');
    const from = f.from.value, to = f.to.value, alias = f.alias?.value.trim();
    (g.payments ||= []).push({ id: uid(), from, to, amount: Math.round(amount * 100) / 100, date: f.date.value || today() });
    if (alias !== undefined) { if (to === 'Yo') (S.me ||= {}).alias = alias; else if (from === 'Yo') (g.aliases ||= {})[to] = alias; }
  },
  tx(f, id) {
    const amount = parseAmount(f.amount.value); if (!(amount > 0)) return toast('Monto inválido');
    const type = f.type.value, raw = f.cat.value.trim().replace(/\s+/g, ' ');
    if (!raw) return toast('Elegí o escribí una categoría');
    let cat = findCat(type, raw);
    if (!cat) { cat = raw[0].toUpperCase() + raw.slice(1); ((S.customCats ||= { gasto: [], ingreso: [] })[type] ||= []).push(cat); }
    if (!f.method.value.trim()) return toast('Elegí una cuenta');
    const o = { id: id || uid(), type, amount, cat, method: ensureMethod(f.method.value), note: f.note.value.trim(), date: f.date.value };
    S.lastMethod = o.method;
    id ? S.tx[S.tx.findIndex(t => t.id === id)] = o : S.tx.push(o);
    month = o.date.slice(0, 7); view = view === 'home' ? 'home' : 'mov';
  },
  debt(f, id) {
    const total = parseAmount(f.total.value), cuotas = parseInt(f.cuotas.value), paid = Math.min(parseInt(f.paid.value) || 0, cuotas);
    if (!(total > 0) || !(cuotas > 0)) return toast('Revisá monto y cuotas');
    if (!f.name.value.trim()) return toast('Poné un nombre a la deuda');
    const o = { id: id || uid(), name: f.name.value.trim(), cuotas, cuotasPagas: paid, cuota: Math.round(total / cuotas * 100) / 100, dueDay: parseInt(f.dueDay.value) || 0 };
    id ? S.debts[S.debts.findIndex(d => d.id === id)] = o : S.debts.push(o);
  },
  loan(f) {
    const amount = parseAmount(f.amount.value); if (!(amount > 0)) return toast('Monto inválido');
    if (!f.person.value.trim()) return toast('Escribí el nombre de la persona');
    S.loans.push({ id: uid(), dir: f.dir.value, person: f.person.value.trim(), amount, concept: f.concept.value.trim(), phone: f.phone.value.trim(), date: f.date.value || today(), payments: [] });
  },
  loanpay(f, id) {
    const l = S.loans.find(x => x.id === id), a = parseAmount(f.amount.value); if (!(a > 0)) return toast('Monto inválido');
    (l.payments ||= []).push({ id: uid(), amount: Math.min(a, loanLeft(l)), date: f.date.value });
    commit(); closeSheet(); sheetPerson(personKey(l)); return 'done';
  },
  group(f) {
    const members = ['Yo', ...f.members.value.split(',').map(s => s.trim()).filter(s => s && s.toLowerCase() !== 'yo')];
    if (!f.name.value.trim()) return toast('Poné un nombre al grupo');
    if (new Set(members.map(m => m.toLowerCase())).size !== members.length) return toast('Hay nombres repetidos');
    const g = { id: uid(), name: f.name.value.trim(), members, expenses: [] }; S.groups.push(g); openGroup = g.id;
  },
  gexp(f, id) {
    const g = S.groups.find(x => x.id === openGroup), amount = parseAmount(f.amount.value), split = [...f.querySelectorAll('[name=split]:checked')].map(c => c.value);
    if (!(amount > 0)) return toast('Monto inválido'); if (!split.length) return toast('Elegí con quién se divide');
    const o = { id: id || uid(), desc: f.desc.value.trim() || 'Gasto', amount, paidBy: f.paidBy.value, split, date: f.date.value || today() };
    id ? g.expenses[g.expenses.findIndex(e => e.id === id)] = o : g.expenses.push(o);
  }
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el) { act[el.dataset.act]?.(el); return; }
  if (e.target.id === 'overlay') closeSheet();
});
document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-form]'); if (!f) return;
  e.preventDefault();
  const r = forms[f.dataset.form](f, f.dataset.id || null);
  if (r === 'done' || r === false) return;
  if (r === undefined) { closeSheet(); commit(); toast('Guardado'); }
});
document.addEventListener('change', e => {
  if (e.target.name === 'dsub') { debtsTab = e.target.value; render(); return; }
  if (e.target.name === 'theme') {
    try { localStorage.setItem('plata.theme', e.target.value); } catch { }
    applyTheme(e.target.value); return;
  }
  if (e.target.id !== 'imp') return;
  const file = e.target.files[0]; if (!file) return;
  file.text().then(t => {
    const v = JSON.parse(t);
    if (!Array.isArray(v.tx) || !Array.isArray(v.debts) || !Array.isArray(v.loans) || !Array.isArray(v.groups)) throw 0;
    if (confirm('Esto reemplaza tus datos actuales por los del backup. ¿Continuar?')) { S = normState(v); closeSheet(); commit(); toast('Backup importado'); }
  }).catch(() => toast('Archivo inválido'));
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
// campo de categoría: desplegable + escritura con filtro por coincidencia
// filas que se agregan después (calculadora, productos, importación): se aplica al tocar
document.addEventListener('pointerdown', e => { const i = e.target; if (i.matches?.('input[type=text],input[type=tel],input[type=search]') && !i.hasAttribute('autocomplete') && !i.hasAttribute('list')) i.setAttribute('autocomplete', 'off'); }, true);
act.combotoggle = el => { const i = el.parentElement.querySelector('input'), l = el.parentElement.querySelector('.combo-list'); if (l.hidden) { comboRender(i, true); i.focus({ preventScroll: true }); } else l.hidden = true; };
act.combopick = el => { const c = el.closest('.combo'); c.querySelector('input').value = el.dataset.v; c.querySelector('.combo-list').hidden = true; };
document.addEventListener('input', e => { if (e.target.matches('.combo input')) comboRender(e.target, false); });
document.addEventListener('input', e => {   // cuenta nueva escrita a mano + efecto en el saldo al cambiar el monto
  const t = e.target;
  if (t.classList?.contains('newin')) { t.form[t.dataset.f].value = t.value; if (t.form.dataset.form === 'move') syncMove(t.form); }
  const f = t.closest?.('form[data-form=tx],form[data-form=move]'); if (f) accEffects(f);
});
document.addEventListener('input', e => { if (e.target.id === 'me-alias') { (S.me ||= {}).alias = e.target.value.trim(); save(); } });
document.addEventListener('focusin', e => { const i = e.target; if (i.matches('.combo input')) { i.dataset.prev = i.value; i.value = ''; comboRender(i, true); } });
document.addEventListener('focusout', e => { const i = e.target; if (i.matches?.('.combo input') && !i.value.trim() && i.dataset.prev) i.value = i.dataset.prev; });
document.addEventListener('click', e => { if (!e.target.closest('.combo')) document.querySelectorAll('.combo-list').forEach(l => l.hidden = true); });

// ---------- arranque ----------
(async () => {
  await load();
  render();
  if (document.readyState === 'loading') await new Promise(r => document.addEventListener('DOMContentLoaded', r));   // onboarding.js se carga después de este archivo
  startOnboarding();   // bienvenida de la primera vez
  // accesos directos (mantener apretado el ícono): ?add=gasto | ingreso | import
  const add = new URLSearchParams(location.search).get('add');
  if (add) { history.replaceState(null, '', location.pathname); add === 'import' ? act.importmov() : formTx(null, add === 'ingreso' ? 'ingreso' : 'gasto'); }
  navigator.storage?.persist?.();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
})();
