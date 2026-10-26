'use strict';
/* Calculadoras para dividir gastos: iguales · quién puso cuánto · por consumo · según ingresos. */
const CCATS = [['alc', '🍷', 'Alcohol'], ['pos', '🍰', 'Postre'], ['esp', '🥗', 'Comida especial'], ['beb', '🥃', 'Bebida especial'], ['caf', '☕', 'Café'], ['otr', '💡', 'Otro']];
const CMODES = [['eq', 'Iguales'], ['who', 'Quién puso'], ['fair', 'Consumo'], ['inc', 'Ingresos']];
let cmode = 'eq', calcN = 2, cText = '', cTransfers = [], cSave = null;   // cSave: lo que se puede guardar en un grupo

const pRow = (mode, i, name = '') => {
  const nm = `<input type="text" class="p-name" placeholder="Nombre" value="${esc(name)}" aria-label="Nombre">`;
  const rm = `<button type="button" class="icon-btn" data-act="calcrm" aria-label="Quitar">✕</button>`;
  if (mode === 'fair') return `<div class="prow col"><div class="rowtop">${nm}${rm}</div><div class="checks">
    <label><input type="checkbox" class="p-common" checked>🧾 Menú común</label>
    ${CCATS.map(([k, e, n]) => `<label data-cat="${k}" hidden><input type="checkbox" class="p-cat" value="${k}">${e} ${n}</label>`).join('')}</div></div>`;
  return `<div class="prow">${nm}${MI(`<input type="text" class="p-amt" inputmode="decimal" placeholder="${mode === 'inc' ? 'ingreso' : 'puso'}" aria-label="Monto">`)}${rm}</div>`;
};
const rowsHtml = (mode, n) => Array.from({ length: n }, (_, i) => pRow(mode, i, i === 0 ? 'Yo' : '')).join('');

const shell = {
  eq: () => `${field('Total de la cuenta', MI(`<input class="money" id="c-total" type="text" inputmode="decimal" placeholder="0" autofocus>`, true))}
    <div class="row"><span class="label">Personas (contándote)</span><span class="row" style="gap:14px"><button class="btn ghost sm" data-act="calcn" data-d="-1" aria-label="Menos">−</button><b id="c-n" style="font-size:22px;min-width:24px;text-align:center">2</b><button class="btn ghost sm" data-act="calcn" data-d="1" aria-label="Más">+</button></span></div>
    <label>Propina<div class="seg">${[0, 10, 15, 20].map((p, i) => `<label><input type="radio" name="tip" value="${p}" ${i ? '' : 'checked'}><span>${p ? p + '%' : 'Sin'}</span></label>`).join('')}</div></label>
    ${field('Redondear lo que pone cada uno', `<select id="c-round"><option value="0">Exacto</option><option value="10">Hacia arriba, a $10</option><option value="50">Hacia arriba, a $50</option><option value="100">Hacia arriba, a $100</option></select>`)}`,
  who: () => `<p class="muted" style="margin:0;font-size:14px">Cargá cuánto puso cada uno. Se reparte en partes iguales y te digo quién le transfiere a quién.</p><div id="c-rows" class="prows">${rowsHtml('who', 3)}</div><button class="btn ghost sm" data-act="calcadd">+ Sumar persona</button>`,
  fair: () => `<p class="muted" style="margin:0;font-size:14px">Lo que no comparten todos se separa y lo pagan solo quienes lo consumieron. El resto va entre los del menú común.</p>
    ${field('Total de la cuenta', MI(`<input class="money" id="c-total" type="text" inputmode="decimal" placeholder="0" autofocus>`, true))}
    <label>Gastos aparte (opcional)<div class="grid2" style="margin:0">${CCATS.map(([k, e, n]) => MI(`<input type="text" id="c-x-${k}" inputmode="decimal" placeholder="${e} ${n}" aria-label="${n}">`)).join('')}</div></label>
    <div id="c-rows" class="prows">${rowsHtml('fair', 3)}</div><button class="btn ghost sm" data-act="calcadd">+ Sumar persona</button>`,
  inc: () => `<p class="muted" style="margin:0;font-size:14px">Cada uno aporta el mismo porcentaje de su ingreso, así nadie banca más de lo que puede.</p>
    ${field('Total a dividir', MI(`<input class="money" id="c-total" type="text" inputmode="decimal" placeholder="0" autofocus>`, true))}
    <div id="c-rows" class="prows">${rowsHtml('inc', 2)}</div><button class="btn ghost sm" data-act="calcadd">+ Sumar persona</button>`
};

function openCalc(mode = 'eq') {
  cmode = mode; calcN = 2;
  sheet('Dividir cuenta', `<div id="calc" style="display:grid;gap:14px">
    <div class="seg">${CMODES.map(([m, n]) => `<label><input type="radio" name="cmode" value="${m}" ${m === mode ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div>
    ${field('Motivo (opcional)', `<input type="text" id="c-why" placeholder="Ej: cena del sábado">`)}
    <div id="c-body" style="display:grid;gap:14px"></div>
    <div class="card hero" id="c-out" style="margin:0"></div>
    <div id="c-actions" class="btns" style="margin:0"></div>
    <div id="c-save" class="card" style="margin:0" hidden></div></div>`);
  setMode(mode);
}
function setMode(m) { cmode = m; calcN = 2; cSave = null; $('#c-save').hidden = true; $('#c-body').innerHTML = shell[m](); calcDraw(); }

const readP = () => {
  const seen = {};
  return [...document.querySelectorAll('#c-rows .prow')].map((r, i) => {
    let name = r.querySelector('.p-name').value.trim() || `Persona ${i + 1}`;
    seen[name.toLowerCase()] = (seen[name.toLowerCase()] || 0) + 1; if (seen[name.toLowerCase()] > 1) name += ` (${seen[name.toLowerCase()]})`;
    return { name, amt: parseAmount(r.querySelector('.p-amt')?.value) || 0, common: !!r.querySelector('.p-common')?.checked, cats: Object.fromEntries([...r.querySelectorAll('.p-cat')].map(c => [c.value, c.checked])) };
  });
};
const hint = t => { $('#c-out').innerHTML = `<div class="muted">${t}</div>`; $('#c-actions').innerHTML = ''; cText = ''; cSave = null; };
const rowLine = (name, sub, val, cls = '') => `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)"><div><b>${esc(name)}</b>${sub ? `<div class="muted" style="font-size:13px">${sub}</div>` : ''}</div><b class="${cls}">${val}</b></div>`;
const shareBtn = `<button class="btn ghost sm" data-act="calcshare">Compartir resumen</button>`;
const groupBtn = `<button class="btn ghost sm" data-act="calcgroup">Guardar en un grupo ›</button>`;
const why = () => $('#c-why')?.value.trim();

function calcDraw() { calcDraw0(); const b = $('#c-save'); if (b && !b.hidden) cSave ? csDraw() : (b.hidden = true); }
function calcDraw0() {
  const total = parseAmount($('#c-total')?.value), why_ = why();
  const head = why_ ? `${why_}\n` : '';
  if (cmode === 'eq') {
    const tip = +($('#calc input[name=tip]:checked')?.value || 0), step = +($('#c-round')?.value || 0);
    $('#c-n').textContent = calcN;
    if (!(total > 0)) return hint('Ingresá el total de la cuenta.');
    const withTip = total * (1 + tip / 100), exact = withTip / calcN, each = step ? Math.ceil(exact / step) * step : Math.round(exact * 100) / 100, extra = each * calcN - withTip;
    $('#c-out').innerHTML = `<div class="label">Cada uno pone</div><div class="big">${money(each)}</div><div class="muted">${tip ? `Cuenta ${money(total)} + propina ${tip}% (${money(withTip - total)}) = ${money(withTip)}` : `Cuenta ${money(total)}`}, entre ${calcN} personas${extra > 0.5 ? ` · sobran ${money(extra)} por el redondeo` : ''}</div>`;
    cText = `${head}Cuenta ${money(withTip)} entre ${calcN}: ${money(each)} cada uno.`;
    $('#c-actions').innerHTML = shareBtn; cSave = null; return;
  }
  const P = readP();
  if (cmode === 'who') {
    const tot = sum(P, p => p.amt);
    if (!(tot > 0)) return hint('Cargá lo que puso cada uno.');
    const share = tot / P.length, bal = Object.fromEntries(P.map(p => [p.name, p.amt - share]));
    cTransfers = settle(bal);
    $('#c-out').innerHTML = `<div class="label">Total ${money(tot)} · le toca a cada uno ${money(share)}</div>
      ${P.map(p => { const b = p.amt - share; return rowLine(p.name, `puso ${money(p.amt)} y le tocaban ${money(share)} → ${b > 0.005 ? 'le deben ' + money(b) : b < -0.005 ? 'debe ' + money(-b) : 'está a mano'}`, (b >= 0 ? '+' : '−') + money(Math.abs(b)), b > 0.005 ? 'pos' : b < -0.005 ? 'neg' : 'muted'); }).join('')}
      <div class="label" style="margin-top:14px">Para quedar a mano</div>
      ${cTransfers.length ? cTransfers.map(t => `<div style="padding:4px 0"><b>${esc(t.from)}</b> → <b>${esc(t.to)}</b> <b style="float:right">${money(t.amount)}</b></div>`).join('') : '<div>Ya están a mano 🎉</div>'}`;
    cText = `${head}Total ${money(tot)} (${money(share)} c/u).\n` + (cTransfers.length ? cTransfers.map(t => `${t.from} le transfiere ${money(t.amount)} a ${t.to}`).join('\n') : 'Todos a mano.');
    const mine = cTransfers.some(t => /^yo( |$)/i.test(t.from) || /^yo( |$)/i.test(t.to));
    const payers = P.filter(p => p.amt > 0.005);
    cSave = { names: P.map(p => p.name), build: () => payers.map(p => ({ desc: `${why_ || 'Cuenta'} (${p.name})`, amount: Math.round(p.amt * 100) / 100, paidBy: p.name, split: P.map(q => q.name) })) };
    $('#c-actions').innerHTML = (mine ? `<button class="btn sm" data-act="calcreg">Registrar lo mío en Personas</button>` : '') + shareBtn + groupBtn; return;
  }
  if (cmode === 'fair') {
    CCATS.forEach(([k]) => { const on = parseAmount($('#c-x-' + k).value) > 0; document.querySelectorAll(`#c-rows [data-cat="${k}"]`).forEach(l => l.hidden = !on); });
    if (!(total > 0)) return hint('Ingresá el total de la cuenta.');
    const ex = Object.fromEntries(CCATS.map(([k]) => [k, parseAmount($('#c-x-' + k).value) || 0])), common = total - sum(Object.values(ex));
    if (common < -0.005) return hint('Los gastos aparte suman más que el total.');
    const nc = P.filter(p => p.common).length, warn = [];
    if (common > 0.005 && !nc) warn.push('Nadie marcó el menú común.');
    const res = P.map(p => { const cm = p.common && nc ? common / nc : 0, ps = CCATS.filter(([k]) => ex[k] > 0 && p.cats[k]).map(([k, e, n]) => [n, ex[k] / P.filter(q => q.cats[k]).length]); return { name: p.name, v: cm + sum(ps, x => x[1]), why: [cm > 0.005 ? `Menú común ${money(cm)}` : '', ...ps.map(([n, v]) => `${n} ${money(v)}`)].filter(Boolean).join(' + ') }; });
    CCATS.forEach(([k, e, n]) => { if (ex[k] > 0 && !P.some(p => p.cats[k])) warn.push(`Nadie marcó ${n.toLowerCase()}.`); });
    $('#c-out').innerHTML = `<div class="label">Le toca a cada uno</div>${res.map(r => rowLine(r.name, r.why, money(r.v))).join('')}${warn.map(w => `<div class="warn" style="margin-top:8px">⚠ ${w}</div>`).join('')}`;
    cText = `${head}Total ${money(total)}:\n` + res.map(r => `${r.name}: ${money(r.v)}`).join('\n');
    const fixed = res.map(r => ({ n: r.name, v: Math.round(r.v * 100) / 100 }));
    cSave = warn.length ? null : { names: P.map(p => p.name), build: paidBy => [cSaveExpense(why_ || 'Cuenta', total, paidBy, fixed)] };
    $('#c-actions').innerHTML = shareBtn + (cSave ? groupBtn : ''); return;
  }
  // ingresos
  const inc = sum(P, p => p.amt);
  if (!(total > 0) || !(inc > 0)) return hint('Ingresá el total y el ingreso de cada uno.');
  const res = P.map(p => ({ name: p.name, pct: p.amt / inc * 100, v: total * p.amt / inc }));
  $('#c-out').innerHTML = `<div class="label">Le toca a cada uno</div>${res.map(r => rowLine(r.name, r.pct.toFixed(1) + '% del total', money(r.v))).join('')}
    <div class="muted" style="margin-top:8px;font-size:13px">Todos aportan el ${(total / inc * 100).toFixed(1)}% de su ingreso.</div>`;
  cText = `${head}Total ${money(total)} según ingresos:\n` + res.map(r => `${r.name}: ${money(r.v)} (${r.pct.toFixed(0)}%)`).join('\n');
  const fixedI = res.map(r => ({ n: r.name, v: Math.round(r.v * 100) / 100 }));
  cSave = { names: P.map(p => p.name), build: paidBy => [cSaveExpense(why_ || 'Cuenta', total, paidBy, fixedI)] };
  $('#c-actions').innerHTML = shareBtn + groupBtn;
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
document.addEventListener('input', e => { if (e.target.closest('#calc') && !e.target.closest('#c-save')) calcDraw(); });
document.addEventListener('change', e => {
  if (!e.target.closest('#calc') || e.target.closest('#c-save')) return;
  if (e.target.name === 'cmode') setMode(e.target.value); else calcDraw();
});

// ---------- guardar el resultado en un grupo ----------
// un gasto del grupo repartido por montos exactos; los centavos de redondeo van al que más paga
function cSaveExpense(desc, total, paidBy, shares) {
  const sh = {}; shares.filter(x => x.v > 0).forEach(x => sh[x.n] = x.v);
  const total2 = Math.round(total * 100) / 100, diff = Math.round((total2 - sum(Object.values(sh), v => v)) * 100) / 100;
  if (diff) { const big = Object.keys(sh).sort((a, b) => sh[b] - sh[a])[0]; sh[big] = Math.round((sh[big] + diff) * 100) / 100; }
  return { desc, amount: total2, paidBy, split: Object.keys(sh), shares: sh, mode: 'exact' };
}
const cNorm = n => /^yo$/i.test(n.trim()) ? 'Yo' : n.trim();
function csDraw() {
  const box = $('#c-save'); if (!cSave) { box.hidden = true; return; }
  const sel = $('#cs-group')?.value ?? (S.groups.length ? S.groups[0].id : 'new'), paid = $('#cs-paid')?.value;
  const g = S.groups.find(x => x.id === sel), names = [...new Set(cSave.names.map(cNorm))];
  const add = g ? names.filter(n => !g.members.some(m => norm(m) === norm(n))) : [];
  const needPaid = cmode !== 'who';
  box.innerHTML = `<label>Grupo<select id="cs-group">${S.groups.map(x => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}<option value="new" ${sel === 'new' ? 'selected' : ''}>+ Grupo nuevo con estas personas</option></select></label>
    ${sel === 'new' ? `<label>Nombre del grupo<input type="text" id="cs-name" value="${esc($('#cs-name')?.value ?? ($('#c-why')?.value.trim() || ''))}" placeholder="Ej: Juntada del sábado" maxlength="40" autocomplete="off"></label>` : ''}
    ${needPaid ? `<label>Pagó<select id="cs-paid">${names.map(n => `<option ${n === (paid || names.find(x => x === 'Yo') || names[0]) ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>` : '<p class="muted" style="margin:0;font-size:14px">Se carga un gasto por cada persona que puso plata, repartido entre todos.</p>'}
    ${add.length ? `<p class="muted" style="margin:0;font-size:14px">Se suman al grupo: <b>${add.map(esc).join(', ')}</b>.</p>` : ''}
    <button class="btn block" data-act="calcsave" style="margin-top:6px">Guardar en el grupo</button>`;
  box.style.display = 'grid'; box.style.gap = '12px'; box.hidden = false;
}
act.calcgroup = () => { if (!cSave) return; const b = $('#c-save'); if (b.hidden) { csDraw(); b.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } else b.hidden = true; };
document.addEventListener('change', e => { if (e.target.id === 'cs-group' || e.target.id === 'cs-paid') csDraw(); });
act.calcsave = () => {
  if (!cSave) return;
  const sel = $('#cs-group').value, names = [...new Set(cSave.names.map(cNorm))], paid = $('#cs-paid')?.value;
  const map = n => cNorm(n);
  let g;
  if (sel === 'new') {
    const name = $('#cs-name').value.trim(); if (!name) return toast('Poné un nombre al grupo');
    g = { id: uid(), name, members: ['Yo', ...names.filter(n => n !== 'Yo')], expenses: [] }; S.groups.push(g);
  } else {
    g = S.groups.find(x => x.id === sel);
    names.forEach(n => { const ex = g.members.find(m => norm(m) === norm(n)); if (!ex) g.members.push(n); else if ((g.hidden || []).includes(ex)) g.hidden = g.hidden.filter(m => m !== ex); });
  }
  const real = n => g.members.find(m => norm(m) === norm(map(n))) || map(n);
  for (const e of cSave.build(paid)) {
    const shares = e.shares ? Object.fromEntries(Object.entries(e.shares).map(([n, v]) => [real(n), v])) : null;
    g.expenses.push({ id: uid(), desc: e.desc, amount: e.amount, paidBy: real(e.paidBy), split: (e.split || []).map(real), ...(shares ? { shares, mode: 'exact' } : {}), date: today() });
  }
  closeSheet(); view = 'groups'; openGroup = g.id; commit(); toast(`Guardado en “${g.name}”`);
};

// ---------- ejemplo precargado ----------
act.calcexample = () => {
  openCalc('who'); $('#c-why').value = 'Juntada (ejemplo)';
  const box = $('#c-rows'); while (box.children.length < 4) box.insertAdjacentHTML('beforeend', pRow('who', box.children.length));
  [['Yo', '3.000'], ['Ana', '12.000'], ['Pedro', '18.000'], ['Lu', '']].forEach(([n, v], i) => { const r = box.children[i]; r.querySelector('.p-name').value = n; r.querySelector('.p-amt').value = v; });
  calcDraw();
};
