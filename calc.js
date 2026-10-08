'use strict';
/* Calculadoras para dividir gastos: iguales · quién puso cuánto · por consumo · según ingresos. */
const CCATS = [['alc', '🍷', 'Alcohol'], ['pos', '🍰', 'Postre'], ['esp', '🥗', 'Comida especial'], ['beb', '🥃', 'Bebida especial'], ['caf', '☕', 'Café'], ['otr', '💡', 'Otro']];
const CMODES = [['eq', 'Iguales'], ['who', 'Quién puso'], ['fair', 'Consumo'], ['inc', 'Ingresos']];
let cmode = 'eq', calcN = 2, cText = '', cTransfers = [];

const pRow = (mode, i, name = '') => {
  const nm = `<input type="text" class="p-name" placeholder="Nombre" value="${esc(name)}" aria-label="Nombre">`;
  const rm = `<button type="button" class="icon-btn" data-act="calcrm" aria-label="Quitar">✕</button>`;
  if (mode === 'fair') return `<div class="prow col"><div class="rowtop">${nm}${rm}</div><div class="checks">
    <label><input type="checkbox" class="p-common" checked>🧾 Menú común</label>
    ${CCATS.map(([k, e, n]) => `<label data-cat="${k}" hidden><input type="checkbox" class="p-cat" value="${k}">${e} ${n}</label>`).join('')}</div></div>`;
  return `<div class="prow">${nm}<input type="text" class="p-amt" inputmode="decimal" placeholder="${mode === 'inc' ? '$ ingreso' : '$ puso'}" aria-label="Monto">${rm}</div>`;
};
const rowsHtml = (mode, n) => Array.from({ length: n }, (_, i) => pRow(mode, i, i === 0 ? 'Yo' : '')).join('');

const shell = {
  eq: () => `${field('Total de la cuenta', `<input class="money" id="c-total" type="text" inputmode="decimal" placeholder="0" autofocus>`)}
    <div class="row"><span class="label">Personas (contándote)</span><span class="row" style="gap:14px"><button class="btn ghost sm" data-act="calcn" data-d="-1" aria-label="Menos">−</button><b id="c-n" style="font-size:22px;min-width:24px;text-align:center">2</b><button class="btn ghost sm" data-act="calcn" data-d="1" aria-label="Más">+</button></span></div>
    <label>Propina<div class="seg">${[0, 10, 15, 20].map((p, i) => `<label><input type="radio" name="tip" value="${p}" ${i ? '' : 'checked'}><span>${p ? p + '%' : 'Sin'}</span></label>`).join('')}</div></label>
    ${field('Redondear lo que pone cada uno', `<select id="c-round"><option value="0">Exacto</option><option value="10">Hacia arriba, a $10</option><option value="50">Hacia arriba, a $50</option><option value="100">Hacia arriba, a $100</option></select>`)}`,
  who: () => `<p class="muted" style="margin:0;font-size:14px">Cargá cuánto puso cada uno. Se reparte en partes iguales y te digo quién le transfiere a quién.</p><div id="c-rows" class="prows">${rowsHtml('who', 3)}</div><button class="btn ghost sm" data-act="calcadd">+ Sumar persona</button>`,
  fair: () => `<p class="muted" style="margin:0;font-size:14px">Lo que no comparten todos se separa y lo pagan solo quienes lo consumieron. El resto va entre los del menú común.</p>
    ${field('Total de la cuenta', `<input class="money" id="c-total" type="text" inputmode="decimal" placeholder="0" autofocus>`)}
    <label>Gastos aparte (opcional)<div class="grid2" style="margin:0">${CCATS.map(([k, e, n]) => `<input type="text" id="c-x-${k}" inputmode="decimal" placeholder="${e} ${n}" aria-label="${n}">`).join('')}</div></label>
    <div id="c-rows" class="prows">${rowsHtml('fair', 3)}</div><button class="btn ghost sm" data-act="calcadd">+ Sumar persona</button>`,
  inc: () => `<p class="muted" style="margin:0;font-size:14px">Cada uno aporta el mismo porcentaje de su ingreso, así nadie banca más de lo que puede.</p>
    ${field('Total a dividir', `<input class="money" id="c-total" type="text" inputmode="decimal" placeholder="0" autofocus>`)}
    <div id="c-rows" class="prows">${rowsHtml('inc', 2)}</div><button class="btn ghost sm" data-act="calcadd">+ Sumar persona</button>`
};

function openCalc(mode = 'eq') {
  cmode = mode; calcN = 2;
  sheet('Dividir cuenta', `<div id="calc" style="display:grid;gap:14px">
    <div class="seg">${CMODES.map(([m, n]) => `<label><input type="radio" name="cmode" value="${m}" ${m === mode ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div>
    ${field('Motivo (opcional)', `<input type="text" id="c-why" placeholder="Ej: cena del sábado">`)}
    <div id="c-body" style="display:grid;gap:14px"></div>
    <div class="card hero" id="c-out" style="margin:0"></div>
    <div id="c-actions" class="btns" style="margin:0"></div></div>`);
  setMode(mode);
}
function setMode(m) { cmode = m; calcN = 2; $('#c-body').innerHTML = shell[m](); calcDraw(); }

const readP = () => {
  const seen = {};
  return [...document.querySelectorAll('#c-rows .prow')].map((r, i) => {
    let name = r.querySelector('.p-name').value.trim() || `Persona ${i + 1}`;
    seen[name.toLowerCase()] = (seen[name.toLowerCase()] || 0) + 1; if (seen[name.toLowerCase()] > 1) name += ` (${seen[name.toLowerCase()]})`;
    return { name, amt: parseAmount(r.querySelector('.p-amt')?.value) || 0, common: !!r.querySelector('.p-common')?.checked, cats: Object.fromEntries([...r.querySelectorAll('.p-cat')].map(c => [c.value, c.checked])) };
  });
};
const hint = t => { $('#c-out').innerHTML = `<div class="muted">${t}</div>`; $('#c-actions').innerHTML = ''; cText = ''; };
const rowLine = (name, sub, val, cls = '') => `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)"><div><b>${esc(name)}</b>${sub ? `<div class="muted" style="font-size:13px">${sub}</div>` : ''}</div><b class="${cls}">${val}</b></div>`;
const shareBtn = `<button class="btn ghost sm" data-act="calcshare">Compartir resumen</button>`;
const why = () => $('#c-why')?.value.trim();

function calcDraw() {
  const total = parseAmount($('#c-total')?.value), why_ = why();
  const head = why_ ? `${why_}\n` : '';
  if (cmode === 'eq') {
    const tip = +($('#calc input[name=tip]:checked')?.value || 0), step = +($('#c-round')?.value || 0);
    $('#c-n').textContent = calcN;
    if (!(total > 0)) return hint('Ingresá el total de la cuenta.');
    const withTip = total * (1 + tip / 100), exact = withTip / calcN, each = step ? Math.ceil(exact / step) * step : Math.round(exact * 100) / 100, extra = each * calcN - withTip;
    $('#c-out').innerHTML = `<div class="label">Cada uno pone</div><div class="big">${money(each)}</div><div class="muted">Total con propina ${money(withTip)}${extra > 0.5 ? ` · sobran ${money(extra)}` : ''}</div>`;
    cText = `${head}Cuenta ${money(withTip)} entre ${calcN}: ${money(each)} cada uno.`;
    $('#c-actions').innerHTML = shareBtn; return;
  }
  const P = readP();
  if (cmode === 'who') {
    const tot = sum(P, p => p.amt);
    if (!(tot > 0)) return hint('Cargá lo que puso cada uno.');
    const share = tot / P.length, bal = Object.fromEntries(P.map(p => [p.name, p.amt - share]));
    cTransfers = settle(bal);
    $('#c-out').innerHTML = `<div class="label">Total ${money(tot)} · le toca a cada uno ${money(share)}</div>
      ${P.map(p => { const b = p.amt - share; return rowLine(p.name, `puso ${money(p.amt)}`, (b >= 0 ? '+' : '−') + money(Math.abs(b)), b > 0.005 ? 'pos' : b < -0.005 ? 'neg' : 'muted'); }).join('')}
      <div class="label" style="margin-top:14px">Para quedar a mano</div>
      ${cTransfers.length ? cTransfers.map(t => `<div style="padding:4px 0"><b>${esc(t.from)}</b> → <b>${esc(t.to)}</b> <b style="float:right">${money(t.amount)}</b></div>`).join('') : '<div>Ya están a mano 🎉</div>'}`;
    cText = `${head}Total ${money(tot)} (${money(share)} c/u).\n` + (cTransfers.length ? cTransfers.map(t => `${t.from} le transfiere ${money(t.amount)} a ${t.to}`).join('\n') : 'Todos a mano.');
    const mine = cTransfers.some(t => /^yo( |$)/i.test(t.from) || /^yo( |$)/i.test(t.to));
    $('#c-actions').innerHTML = (mine ? `<button class="btn sm" data-act="calcreg">Registrar lo mío en Personas</button>` : '') + shareBtn; return;
  }
  if (cmode === 'fair') {
    CCATS.forEach(([k]) => { const on = parseAmount($('#c-x-' + k).value) > 0; document.querySelectorAll(`#c-rows [data-cat="${k}"]`).forEach(l => l.hidden = !on); });
    if (!(total > 0)) return hint('Ingresá el total de la cuenta.');
    const ex = Object.fromEntries(CCATS.map(([k]) => [k, parseAmount($('#c-x-' + k).value) || 0])), common = total - sum(Object.values(ex));
    if (common < -0.005) return hint('Los gastos aparte suman más que el total.');
    const nc = P.filter(p => p.common).length, warn = [];
    if (common > 0.005 && !nc) warn.push('Nadie marcó el menú común.');
    const res = P.map(p => ({ name: p.name, v: (p.common && nc ? common / nc : 0) + sum(CCATS.filter(([k]) => ex[k] > 0 && p.cats[k]), ([k]) => ex[k] / P.filter(q => q.cats[k]).length) }));
    CCATS.forEach(([k, e, n]) => { if (ex[k] > 0 && !P.some(p => p.cats[k])) warn.push(`Nadie marcó ${n.toLowerCase()}.`); });
    $('#c-out').innerHTML = `<div class="label">Le toca a cada uno</div>${res.map(r => rowLine(r.name, '', money(r.v))).join('')}${warn.map(w => `<div class="warn" style="margin-top:8px">⚠ ${w}</div>`).join('')}`;
    cText = `${head}Total ${money(total)}:\n` + res.map(r => `${r.name}: ${money(r.v)}`).join('\n');
    $('#c-actions').innerHTML = shareBtn; return;
  }
  // ingresos
  const inc = sum(P, p => p.amt);
  if (!(total > 0) || !(inc > 0)) return hint('Ingresá el total y el ingreso de cada uno.');
  const res = P.map(p => ({ name: p.name, pct: p.amt / inc * 100, v: total * p.amt / inc }));
  $('#c-out').innerHTML = `<div class="label">Le toca a cada uno</div>${res.map(r => rowLine(r.name, r.pct.toFixed(1) + '% del total', money(r.v))).join('')}
    <div class="muted" style="margin-top:8px;font-size:13px">Todos aportan el ${(total / inc * 100).toFixed(1)}% de su ingreso.</div>`;
  cText = `${head}Total ${money(total)} según ingresos:\n` + res.map(r => `${r.name}: ${money(r.v)} (${r.pct.toFixed(0)}%)`).join('\n');
  $('#c-actions').innerHTML = shareBtn;
}

act.calc = () => openCalc();
act.calcmode = el => openCalc(el.dataset.m);
act.calcn = el => { calcN = Math.min(50, Math.max(2, calcN + +el.dataset.d)); calcDraw(); };
act.calcadd = () => { const box = $('#c-rows'); box.insertAdjacentHTML('beforeend', pRow(cmode, box.children.length)); calcDraw(); };
act.calcrm = el => { const box = $('#c-rows'); if (box.children.length <= 2) return toast('Mínimo 2 personas'); el.closest('.prow').remove(); calcDraw(); };
act.calcshare = () => {
  if (!cText) return;
  if (navigator.share) navigator.share({ text: cText }).catch(() => { });
  else window.open('https://wa.me/?text=' + encodeURIComponent(cText), '_blank', 'noopener');
};
act.calcreg = () => {
  const isYo = n => /^yo( |$)/i.test(n), concept = why() || 'División de cuenta';
  cTransfers.forEach(t => {
    if (isYo(t.to)) S.loans.push({ id: uid(), dir: 'me-deben', person: t.from, amount: Math.round(t.amount * 100) / 100, concept, phone: '', date: today(), payments: [] });
    else if (isYo(t.from)) S.loans.push({ id: uid(), dir: 'debo', person: t.to, amount: Math.round(t.amount * 100) / 100, concept, phone: '', date: today(), payments: [] });
  });
  closeSheet(); view = 'debts'; debtsTab = 'people'; commit(); toast('Registrado en Deudas');
};
// "Pagué yo" en modo iguales: se ofrece cuando hay resultado
document.addEventListener('input', e => { if (e.target.closest('#calc')) calcDraw(); });
document.addEventListener('change', e => {
  if (!e.target.closest('#calc')) return;
  if (e.target.name === 'cmode') setMode(e.target.value); else calcDraw();
});
