'use strict';
/* Bienvenida (solo la primera vez): 1) qué es Plata y que es privada, 2) con cuánta plata arranca cada cuenta.
   Sin saldos iniciales, el primer gasto dejaría el Balance general en negativo y la app parecería rota. Todo se puede saltar. */

const ONB_KEY = 'plata.onb';
const onbSeen = () => { try { return localStorage.getItem(ONB_KEY) === '1'; } catch { return true; } };   // sin almacenamiento no se muestra (no se podría recordar que ya se vio)
const onbMark = () => { try { localStorage.setItem(ONB_KEY, '1'); } catch { } };
const onbEmpty = () => !S.tx.length && !S.debts.length && !S.loans.length && !S.groups.length && !(S.moves || []).length && !Object.keys(S.accInit || {}).length;

const ONB_ICON = {
  lock: '<rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  free: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v9M9.5 10c0-1 1-1.7 2.5-1.7s2.5.7 2.5 1.7-1 1.5-2.5 1.7-2.5.7-2.5 1.7 1 1.7 2.5 1.7 2.5-.7 2.5-1.7"/>',
  bolt: '<path d="M13 3L5 13h6l-1 8 8-10h-6z"/>'
};
const onbSvg = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${ONB_ICON[k]}</svg>`;
const ONB_ACCS = [['Efectivo', 'Efectivo'], ['Mercado Pago', 'Mercado Pago'], ['Banco o débito', 'Débito']];   // [lo que se ve, la cuenta que se guarda]

let onbStep = 1, onbExtra = 0;

function onbDots(n) { return `<div class="onb-dots" aria-hidden="true">${[1, 2].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</div>`; }

function onbDraw() {
  const box = $('#onb'); if (!box) return;
  if (onbStep === 1) {
    box.innerHTML = `${onbDots(1)}
      <img class="onb-logo" src="icons/icon.svg" alt="" width="84" height="84">
      <h1 id="onb-h" tabindex="-1">Tu plata, ordenada</h1><p class="onb-lead">Anotá lo que gastás y mirá en qué se va. Sin cuenta ni registro.</p>
      <div class="onb-pts">
        <div><span class="ico">${onbSvg('lock')}</span><p><b>Queda en tu celu</b><span>Tus datos no salen de este teléfono.</span></p></div>
        <div><span class="ico">${onbSvg('free')}</span><p><b>Gratis, sin mail ni contraseña</b><span>Abrís y empezás.</span></p></div>
        <div><span class="ico">${onbSvg('bolt')}</span><p><b>Anotar lleva 5 segundos</b><span>Monto, categoría y listo.</span></p></div>
      </div>
      <div class="onb-push"></div>
      <button class="btn block" data-act="onbnext">Empezar</button>
      <label class="onb-skip" style="cursor:pointer">Ya tengo un backup<input type="file" accept="application/json" id="onb-imp" hidden></label>`;
  } else {
    const rows = ONB_ACCS.map(([label, key]) => {
      const v = Number((S.accInit || {})[key]) || 0, k = METHOD_SLOT[key] || hashSlot(key);
      return `<div class="onb-acc"><div class="dot${k === 5 ? ' d5' : ''}" style="background:var(--c${k})">${stamp(label)}</div>
        <label><span class="nm">${esc(label)}</span>${MI(`<input class="onb-amt" data-key="${esc(key)}" inputmode="decimal" placeholder="0" autocomplete="off" value="${v ? fmtIn(v) : ''}" aria-label="${esc(label)}">`)}</label></div>`;
    }).join('');
    box.innerHTML = `<div class="onb-top"><button class="onb-back" data-act="onbback" aria-label="Volver">‹</button>${onbDots(2)}</div>
      <h1 id="onb-h" tabindex="-1">¿Con cuánta plata arrancás?</h1><p class="onb-lead">Así el balance de Inicio es real desde el primer día. Lo podés cambiar cuando quieras en Ajustes → Mis cuentas y saldos.</p>
      <div id="onb-accs">${rows}<div id="onb-extra"></div></div>
      <button class="btn ghost sm" data-act="onbadd" style="align-self:flex-start;margin:0 0 6px">+ Agregar otra cuenta</button>
      <div class="onb-sum"><span class="muted">Tenés en total</span><b id="onb-total">${money(0)}</b></div>
      <div class="onb-push"></div>
      <button class="btn block" data-act="onbdone">Seguir</button>
      <button class="onb-skip" data-act="onbskip">Omitir por ahora</button>`;
    onbTotal();
  }
  box.scrollTop = 0; $('#onb-h')?.focus();
}
function onbRead() {   // [{ key|name, amount }] de lo escrito
  const out = [];
  document.querySelectorAll('#onb .onb-amt').forEach(i => { const v = i.value.trim() ? parseAmount(i.value) : 0; out.push({ key: i.dataset.key || '', name: (i.closest('.onb-acc')?.querySelector('.onb-name')?.value || '').trim(), amount: v, el: i }); });
  return out;
}
function onbTotal() { const t = $('#onb-total'); if (t) t.textContent = money(sum(onbRead().filter(r => !isNaN(r.amount)), r => r.amount)); }
function onbClose() { onbMark(); const b = $('#onb'); if (b) b.hidden = true; document.body.classList.remove('onb-open'); }
function showOnb(replay) {
  if (replay) closeSheet();
  onbStep = 1; $('#onb').hidden = false; document.body.classList.add('onb-open'); onbDraw();
}
function startOnboarding() {
  if (onbSeen()) return;
  if (!onbEmpty()) { onbMark(); return; }   // quien ya tiene datos (o importó un backup) no necesita la bienvenida
  showOnb();
}

act.onbnext = () => { onbStep = 2; onbDraw(); };
act.onbback = () => { onbStep = 1; onbDraw(); };
act.onbskip = () => { onbClose(); toast('Listo. Tocá + para anotar lo primero'); };
act.onbadd = () => {
  onbExtra++;
  $('#onb-extra').insertAdjacentHTML('beforeend', `<div class="onb-acc"><div class="dot" style="background:var(--chip);color:var(--muted)">+</div>
    <label><input type="text" class="onb-name" placeholder="Nombre (ej: Banco Galicia)" maxlength="30" autocomplete="off" aria-label="Nombre de la cuenta">${MI('<input class="onb-amt" inputmode="decimal" placeholder="0" autocomplete="off" aria-label="Saldo de la cuenta">')}</label></div>`);
  document.querySelector('#onb-extra .onb-acc:last-child .onb-name').focus();
};
act.onbdone = () => {
  const rows = onbRead(), bad = rows.find(r => isNaN(r.amount) || r.amount < 0);
  if (bad) { bad.el.focus(); return toast('Revisá el monto: tiene que ser un número'); }
  const extra = rows.filter(r => !r.key && r.amount && !r.name);
  if (extra.length) { extra[0].el.closest('.onb-acc').querySelector('.onb-name').focus(); return toast('Poné un nombre a la cuenta'); }
  S.accInit ||= {};
  for (const r of rows) {
    const n = r.key || (r.name ? ensureMethod(r.name) : '');
    if (!n) continue;
    if (r.amount) S.accInit[n] = Math.round(r.amount * 100) / 100; else if (r.key) delete S.accInit[n];
  }
  onbClose(); commit();
  toast(rows.some(r => r.amount) ? 'Listo. Tocá + para anotar tu primer gasto' : 'Listo. Tocá + para anotar lo primero');
};
act.onb = () => showOnb(true);   // desde Ajustes: volver a ver la bienvenida

document.addEventListener('input', e => { if (e.target.matches?.('#onb .onb-amt')) onbTotal(); });
document.addEventListener('change', e => {
  if (e.target.id !== 'onb-imp') return;
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  file.text().then(t => {
    const v = JSON.parse(t);
    if (!Array.isArray(v.tx) || !Array.isArray(v.debts) || !Array.isArray(v.loans) || !Array.isArray(v.groups)) throw 0;
    S = normState(v); onbClose(); commit(); toast('Backup importado');
  }).catch(() => toast('Ese archivo no es un backup de Plata'));
});
