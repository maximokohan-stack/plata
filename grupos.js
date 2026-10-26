'use strict';
/* Editar un grupo: cambiar el nombre y sumar, ocultar o sacar integrantes.
   "Ocultar" = ya no aparece para gastos nuevos, pero su historial y lo que debe/le deben se mantienen.
   "Sacar" solo se ofrece si todavía no participó de nada. */

const gCur = () => S.groups.find(x => x.id === openGroup);
const gUsed = (g, n) => g.expenses.some(e => e.paidBy === n || (e.split || []).includes(n) || Object.hasOwn(e.shares || {}, n) || (e.items || []).some(i => (i.split || []).includes(n)))
  || (g.payments || []).some(p => p.from === n || p.to === n);

function sheetGroupEdit(name) {
  const g = gCur(); if (!g) return;
  const hid = g.hidden || [];
  const rows = g.members.filter(m => m !== 'Yo').map(m => {
    const used = gUsed(g, m), off = hid.includes(m);
    return `<div class="mrow"><div><b>${esc(m)}</b><div class="s muted" style="font-size:13px">${off ? 'Ya no está en el grupo' : used ? 'Tiene gastos: se puede ocultar, no borrar' : 'Sin gastos todavía'}</div></div>
      <button type="button" class="btn ghost sm" data-act="${used ? 'gmhide' : 'gmrm'}" data-n="${esc(m)}">${off ? 'Volver a sumar' : used ? 'Ocultar' : 'Sacar'}</button></div>`;
  }).join('');
  sheet('Editar grupo', `<form data-form="gedit">
    ${field('Nombre del grupo', `<input type="text" name="name" id="ge-name" value="${esc(name ?? g.name)}" maxlength="40" required>`)}
    <div class="label muted" style="margin:4px 0 0">Integrantes</div>
    <div class="mrow"><div><b>Yo</b><div class="s muted" style="font-size:13px">Siempre estás vos</div></div></div>${rows}
    <label style="margin-top:6px">Sumar integrante<span style="display:flex;gap:8px"><input type="text" id="ge-new" placeholder="Nombre" maxlength="30" autocomplete="off" style="flex:1"><button type="button" class="btn sm" data-act="gmadd" style="min-height:52px">Sumar</button></span></label>
    <p class="muted" style="font-size:13.5px;margin:0">Quien se suma después aparece en los gastos nuevos; los anteriores no cambian.</p>
    <button class="btn block">Guardar</button></form>`);
}
const gKeepName = () => $('#ge-name')?.value;

forms.gedit = f => {
  const g = gCur(), n = f.name.value.trim();
  if (!n) return toast('Poné un nombre al grupo');
  g.name = n;
};
act.gedit = () => sheetGroupEdit();
act.gmadd = () => {
  const g = gCur(), inp = $('#ge-new'), raw = inp.value.trim().replace(/\s+/g, ' '), name = gKeepName();
  if (!raw) return toast('Escribí el nombre');
  const dup = g.members.find(m => norm(m) === norm(raw));
  if (dup && !(g.hidden || []).includes(dup)) return toast('Ya está en el grupo');
  if (dup) g.hidden = g.hidden.filter(m => m !== dup);
  else g.members.push(raw[0].toUpperCase() + raw.slice(1));
  commit(); sheetGroupEdit(name); $('#ge-new')?.focus();
};
act.gmhide = el => {
  const g = gCur(), n = el.dataset.n, name = gKeepName(); g.hidden ||= [];
  g.hidden = g.hidden.includes(n) ? g.hidden.filter(m => m !== n) : [...g.hidden, n];
  commit(); sheetGroupEdit(name);
};
act.gmrm = el => {
  const g = gCur(), n = el.dataset.n, name = gKeepName();
  if (gUsed(g, n)) return toast('Ya tiene gastos: no se puede sacar');
  g.members = g.members.filter(m => m !== n); g.hidden = (g.hidden || []).filter(m => m !== n); if (g.aliases) delete g.aliases[n];
  commit(); sheetGroupEdit(name);
};
