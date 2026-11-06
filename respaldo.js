'use strict';
/* Copia de seguridad visible: fecha de la última copia, exportar, restaurar con vista previa y volver atrás.
   Antes de cualquier operación que reemplaza o borra todo (restaurar, borrar todo) se guarda una copia de lo que había,
   para poder recuperarla desde Ajustes. */

const LB_KEY = 'plata.lastBackup', REC_KEY = 'plata.recovery';
const lsGet = k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
const lastBackup = () => lsGet(LB_KEY);
const niceDate = iso => new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });
function whenText(iso) {
  const d = Math.floor((Date.now() - Date.parse(iso)) / 864e5);
  return d <= 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días (${niceDate(iso)})`;
}
const daysSinceBackup = () => { const lb = lastBackup(); return lb ? Math.floor((Date.now() - Date.parse(lb)) / 864e5) : null; };

// texto de "Tus datos" en Ajustes
function backupStatusHtml() {
  const d = daysSinceBackup(), has = S.tx.length || S.loans.length || S.groups.length, stale = has && (d === null || d > 30);
  const rec = (() => { try { return JSON.parse(lsGet(REC_KEY) || 'null'); } catch { return null; } })();
  return `<p class="muted" style="margin:0">Tus datos viven en este dispositivo: Plata no tiene cuenta ni servidor. Si cambiás de celular o borrás los datos del navegador, se pierden. Si usás la IA (opcional), lo que le pedís se envía al proveedor que elegiste.</p>
    <div class="card" style="margin:0;padding:12px 14px;${stale ? 'box-shadow:inset 0 0 0 2px var(--warn)' : ''}"><div class="label">Última copia de seguridad</div>
      <b style="font:600 18px var(--display)" class="${stale ? 'warn' : ''}">${d === null ? 'Todavía no hiciste ninguna' : whenText(lastBackup())}</b>
      ${stale ? '<div class="muted" style="font-size:13.5px;margin-top:2px">Conviene hacer una copia ahora.</div>' : ''}</div>
    ${savedInReserve ? '<p class="warn" style="margin:0;font-size:13.5px">El almacenamiento principal no está disponible: se están guardando tus datos en una reserva del navegador. Exportá una copia.</p>' : ''}
    ${rec ? `<button class="btn ghost block" data-act="undorestore">Volver a los datos de antes de ${esc(rec.reason)} (${esc(niceDate(rec.at))})</button>` : ''}
    ${lsGet('plata.premig') ? `<button class="btn ghost block" data-act="premig">Descargar la copia previa a la última actualización de datos</button>` : ''}`;
}
// recordatorio en Inicio: solo si hay datos y la última copia es vieja o no existe
function backupNudge() {
  const d = daysSinceBackup();
  if (S.tx.length < 5 || (d !== null && d <= 30)) return '';
  return `<button class="card" data-act="settings" style="text-align:left;width:100%;display:flex;gap:12px;align-items:center"><span style="flex:1"><b style="display:block">${d === null ? 'Todavía no hiciste una copia de seguridad' : `Tu última copia fue ${whenText(lastBackup())}`}</b><span class="muted" style="font-size:13.5px">Tus datos están solo en este celular. Tocá para guardar una copia.</span></span><span class="ch" aria-hidden="true">›</span></button>`;
}

function download(name, obj) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1e3);
}
act.export = () => {
  const at = new Date().toISOString();
  download(`plata-backup-${today()}.json`, { ...JSON.parse(JSON.stringify(S)), schemaVersion: Core.SCHEMA, _meta: { app: 'plata', at } });
  lsSet(LB_KEY, at); toast('Copia guardada en tus descargas');
  if (!$('#overlay').hidden && $('#sheet-title').textContent === 'Ajustes y backup') act.settings();
};

// ---------- copia de lo que había, antes de reemplazar o borrar ----------
async function snapshotForRecovery(reason) {
  const rec = { at: new Date().toISOString(), reason, state: JSON.parse(JSON.stringify(S)) };
  try { await idbPut(await idb(), 'recovery', rec); lsSet(REC_KEY, JSON.stringify({ at: rec.at, reason })); return true; } catch { }
  if (lsSet('plata.recovery.state', JSON.stringify(rec))) { lsSet(REC_KEY, JSON.stringify({ at: rec.at, reason })); return true; }
  return false;
}
async function readRecovery() {
  try { const r = await idbGet(await idb(), 'recovery'); if (r) return r; } catch { }
  try { return JSON.parse(lsGet('plata.recovery.state') || 'null'); } catch { return null; }
}
act.undorestore = async () => {
  const rec = await readRecovery(); if (!rec) return toast('No encontré la copia de antes');
  if (!confirm(`Esto reemplaza tus datos actuales por los que tenías antes de ${rec.reason} (${niceDate(rec.at)}). ¿Seguro?`)) return;
  if (!(await snapshotForRecovery('volver atrás'))) return toast('No pude guardar una copia de tus datos actuales; no se cambió nada');
  S = Core.migrate(rec.state, uid).state;
  if (await commit()) { closeSheet(); toast('Volviste a los datos de antes'); }
};
act.premig = async () => {
  let r = null; try { r = await idbGet(await idb(), 'premigration'); } catch { }
  if (!r) { try { r = JSON.parse(lsGet('plata.premigration') || 'null'); } catch { } }
  if (!r) return toast('No encontré esa copia');
  download(`plata-copia-previa-v${r.from}.json`, r.state);
};

// ---------- restaurar con vista previa ----------
let pendingRestore = null;
function previewRestore(file) {
  file.text().then(t => {
    let v; try { v = JSON.parse(t); } catch { return toast('Ese archivo no es un backup de Plata (no se puede leer)'); }
    if (!v || !Array.isArray(v.tx) || !Array.isArray(v.debts) || !Array.isArray(v.loans) || !Array.isArray(v.groups)) return toast('Ese archivo no es un backup de Plata');
    const nu = Core.summarize(v), now = Core.summarize(S);
    if (nu.version > Core.SCHEMA) return toast('Esa copia es de una versión más nueva de Plata. Actualizá la app primero.');
    pendingRestore = v;
    const row = (l, a, b) => `<span>${l}</span><span class="n">${a}</span><span class="n">${b}</span>`;
    const per = x => (x.from ? `${niceDate(x.from)} → ${niceDate(x.to)}` : '—');
    sheet('Restaurar copia', `<p style="margin:0">Mirá qué trae la copia y qué tenés ahora. <b>Al restaurar, tus datos actuales se reemplazan por los de la copia.</b></p>
      <div class="cmp3"><span></span><span class="h">Copia</span><span class="h">Ahora</span>${row('Movimientos', nu.movements, now.movements)}${row('Cuentas', nu.accounts, now.accounts)}${row('Préstamos', nu.loans, now.loans)}${row('Deudas', nu.debts, now.debts)}${row('Grupos', nu.groups, now.groups)}</div>
      <p class="muted" style="margin:0;font-size:13.5px">Período de la copia: ${per(nu)}${nu.exportedAt ? ` · guardada el ${niceDate(nu.exportedAt)}` : ''}<br>Período actual: ${per(now)}</p>
      ${nu.movements < now.movements ? '<p class="warn" style="margin:0;font-size:14px">⚠ La copia tiene menos movimientos que tus datos actuales: se perderían los que no estén en ella.</p>' : ''}
      ${nu.version < Core.SCHEMA ? '<p class="muted" style="margin:0;font-size:13.5px">Es una copia de un formato anterior: se actualiza al restaurar, sin perder datos.</p>' : ''}
      <p class="muted" style="margin:0;font-size:13.5px">Antes de reemplazar, guardo una copia de lo que tenés ahora: la podés recuperar desde Ajustes.</p>
      <button class="btn block" data-act="dorestore">Restaurar esta copia</button><button class="btn ghost block" data-act="close">Cancelar</button>`);
  }, () => toast('No pude leer el archivo'));
}
act.dorestore = async () => {
  if (!pendingRestore) return;
  if (!(await snapshotForRecovery('restaurar una copia'))) return toast('No pude guardar una copia de tus datos actuales, así que no restauré nada. Exportá un backup primero.');
  S = Core.migrate({ ...S, ...pendingRestore }, uid).state; pendingRestore = null;
  if (await commit()) { closeSheet(); toast('Copia restaurada'); }
};

// ---------- borrar todo (con copia previa para poder recuperarlo) ----------
act.wipe = async () => {
  if (!(confirm('Esto borra TODOS tus datos de este dispositivo. ¿Seguro?') && confirm('Última chance: ¿borrar todo?'))) return;
  if (!(await snapshotForRecovery('borrar todo'))) return toast('No pude guardar una copia de seguridad, así que no borré nada. Exportá un backup primero.');
  S = { tx: [], debts: [], loans: [], groups: [] }; closeSheet();
  if (await commit()) toast('Borrado. Si fue sin querer, podés recuperarlo desde Ajustes.');
};
