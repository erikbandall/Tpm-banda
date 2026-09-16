'use strict';

/* ======================== Tema claro/oscuro ======================== */

const THEME_KEY = 'toolmaint-theme';

function isDarkActive() {
  const explicit = document.documentElement.getAttribute('data-theme');
  if (explicit === 'dark') return true;
  if (explicit === 'light') return false;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function updateThemeToggleIcon() {
  const btn = document.getElementById('btnThemeToggle');
  if (btn) btn.textContent = isDarkActive() ? '☀️' : '🌙';
}

(function initThemeToggle() {
  updateThemeToggleIcon();
  const btn = document.getElementById('btnThemeToggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const next = isDarkActive() ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* localStorage no disponible */ }
    updateThemeToggleIcon();
  });
})();

/* ======================== Sesión / autenticación ======================== */

let currentUser = null;
function isAdmin() { return !!currentUser && currentUser.role === 'admin'; }
function isTecnico() { return !!currentUser && currentUser.role === 'tecnico'; }
function isIngeniero() { return !!currentUser && currentUser.role === 'ingeniero'; }
function canCompleteMaintenance() { return isAdmin() || isTecnico(); }
const ROLE_LABELS = { admin: 'Administrador', ingeniero: 'Ingeniero', tecnico: 'Técnico' };

function showLoginScreen() {
  document.getElementById('appShell').classList.add('hidden');
  document.getElementById('loginScreen').classList.remove('hidden');
}

function showApp() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appShell').classList.remove('hidden');
}

function initials(name) {
  return String(name || '?').split(/[.\s]/).filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase();
}

function paintUserChip() {
  document.getElementById('userAvatar').textContent = initials(currentUser.username);
  document.getElementById('userNameLabel').textContent = currentUser.username;
  document.getElementById('userRoleLabel').textContent = ROLE_LABELS[currentUser.role] || currentUser.role;
}

// Muestra/oculta botones y secciones según el rol de la cuenta activa. El
// backend ya rechaza estas acciones si alguien las intenta sin permiso; esto
// es solo para que la interfaz no ofrezca botones que de todas formas fallarían.
function applyRolePermissions() {
  const adminOnlyIds = ['btnNewTool', 'btnImportTools', 'btnNewSchedule', 'btnNewTechnician', 'btnNewLine', 'usersSubtabBtn'];
  adminOnlyIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !isAdmin());
  });
  const btnNewLog = document.getElementById('btnNewLog');
  if (btnNewLog) btnNewLog.classList.toggle('hidden', !canCompleteMaintenance());
  if (!isAdmin()) {
    // Por si quedó abierto de una sesión anterior con más permisos: nunca
    // debe verse la lista de cuentas ni quedar seleccionado ese subtab.
    document.getElementById('csub-users').classList.add('hidden');
    document.getElementById('csub-technicians').classList.remove('hidden');
    document.getElementById('csub-lines').classList.add('hidden');
    configSub = 'technicians';
    document.querySelectorAll('#tab-config .subtabs .subtab-btn').forEach(b => b.classList.toggle('active', b.dataset.csub === 'technicians'));
  }
  document.body.classList.toggle('role-admin', isAdmin());
  document.body.classList.toggle('role-ingeniero', isIngeniero());
  document.body.classList.toggle('role-tecnico', isTecnico());
}

document.getElementById('loginPwToggle').addEventListener('click', () => {
  const inp = document.getElementById('loginPass');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('loginError');
  errEl.classList.add('hidden');
  try {
    const user = await api('POST', '/api/auth/login', {
      username: document.getElementById('loginUser').value.trim(),
      password: document.getElementById('loginPass').value
    });
    currentUser = user;
    document.getElementById('loginForm').reset();
    showApp();
    paintUserChip();
    applyRolePermissions();
    startApp();
  } catch (err) {
    document.getElementById('loginErrorText').textContent = err.message;
    errEl.classList.remove('hidden');
  }
});

document.getElementById('userChipBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('userMenu').classList.toggle('hidden');
});
document.addEventListener('click', () => document.getElementById('userMenu').classList.add('hidden'));
document.getElementById('btnLogout').addEventListener('click', async () => {
  try { await api('POST', '/api/auth/logout'); } catch (e) { /* ignore */ }
  currentUser = null;
  showLoginScreen();
});

async function checkSession() {
  try {
    currentUser = await api('GET', '/api/auth/me');
    showApp();
    paintUserChip();
    applyRolePermissions();
    startApp();
  } catch (err) {
    showLoginScreen();
  }
}

/* ======================== Helpers ======================== */

async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) {
    if (res.status === 401 && currentUser) {
      currentUser = null;
      showLoginScreen();
    }
    const msg = (data && data.error) || `Error ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(d) {
  if (!d) return '—';
  return String(d).slice(0, 10);
}

function fmtMoney(n) {
  if (n === null || n === undefined || n === '') return '—';
  return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

let toastTimer = null;
function toast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = isError ? 'error' : '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.add('hidden'); }, 3200);
}

const CATEGORY_LABELS = { maquina: 'Máquina', herramienta: 'Herramienta', proceso: 'Proceso', equipo: 'Equipo' };
function categoryLabel(cat) { return CATEGORY_LABELS[cat] || cat || '—'; }

/* ------------------------ Evidencia PDF (bitácora) ------------------------ */

function evidenceButtonHtml(log) {
  return log.evidence_filename
    ? `<a class="btn btn-secondary btn-sm" href="/api/maintenance/logs/${log.id}/evidence" target="_blank" rel="noopener">📄 Ver PDF</a>`
    : `<button class="btn btn-secondary btn-sm" data-action="attach-evidence" data-id="${log.id}">+ PDF</button>`;
}

function pickAndUploadEvidence(logId, onDone) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/pdf';
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('evidence', file);
    try {
      const res = await fetch(`/api/maintenance/logs/${logId}/evidence`, { method: 'POST', body: fd });
      let data = null;
      try { data = await res.json(); } catch (e) { /* no body */ }
      if (!res.ok) throw new Error((data && data.error) || `Error ${res.status}`);
      toast('Evidencia adjuntada');
      if (onDone) await onDone();
    } catch (err) { toast(err.message, true); }
  });
  input.click();
}

/* ------------------------ Fotografía de herramienta/equipo/fixture ------------------------ */

function toolPhotoUrl(tool) {
  return tool.photo_filename ? `/api/tools/${tool.id}/photo?v=${encodeURIComponent(tool.photo_filename)}` : null;
}

function toolThumbHtml(tool, size) {
  const px = size || 36;
  const url = toolPhotoUrl(tool);
  return url
    ? `<img class="tool-thumb" src="${url}" alt="" style="width:${px}px;height:${px}px;">`
    : `<div class="tool-thumb tool-thumb-placeholder" style="width:${px}px;height:${px}px;">${categoryIcon(tool.category)}</div>`;
}

function categoryIcon(cat) {
  return { maquina: '⚙️', herramienta: '🔧', proceso: '🔄', equipo: '📦' }[cat] || '📦';
}

function pickAndUploadPhoto(toolId, onDone) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp';
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('photo', file);
    try {
      const res = await fetch(`/api/tools/${toolId}/photo`, { method: 'POST', body: fd });
      let data = null;
      try { data = await res.json(); } catch (e) { /* no body */ }
      if (!res.ok) throw new Error((data && data.error) || `Error ${res.status}`);
      toast('Fotografía guardada');
      if (onDone) await onDone();
    } catch (err) { toast(err.message, true); }
  });
  input.click();
}

async function removeToolPhoto(toolId, onDone) {
  if (!confirm('¿Quitar la fotografía de este activo?')) return;
  try {
    await api('DELETE', `/api/tools/${toolId}/photo`);
    toast('Fotografía eliminada');
    if (onDone) await onDone();
  } catch (err) { toast(err.message, true); }
}

function statusBadge(status) {
  const labels = { activo: 'Activo', en_mantenimiento: 'En mantenimiento', baja: 'Baja' };
  return `<span class="badge badge-${status}">${labels[status] || status}</span>`;
}

function dueBadge(nextDue) {
  const today = todayStr();
  if (nextDue < today) return `<span class="badge badge-overdue">Vencida</span>`;
  const horizon = new Date(); horizon.setDate(horizon.getDate() + 7);
  if (nextDue <= horizon.toISOString().slice(0, 10)) return `<span class="badge badge-upcoming">Próxima</span>`;
  return `<span class="badge badge-ok">Al día</span>`;
}

function onTimeBadge(onTime) {
  if (onTime === null || onTime === undefined) return '<span class="muted">—</span>';
  return onTime ? '<span class="badge badge-ok">A tiempo</span>' : '<span class="badge badge-overdue">Tarde</span>';
}

/* ======================== Modal ======================== */

const modalOverlay = document.getElementById('modalOverlay');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');
const modalEl = modalOverlay.querySelector('.modal');

function openModal(title, bodyHtml, wide) {
  modalTitle.textContent = title;
  modalBody.innerHTML = bodyHtml;
  modalEl.classList.toggle('modal-wide', !!wide);
  modalOverlay.classList.remove('hidden');
}
function closeModal() {
  modalOverlay.classList.add('hidden');
  modalBody.innerHTML = '';
  modalEl.classList.remove('modal-wide');
}
document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });

/* ======================== Shared caches ======================== */

let toolsCache = [];
let techniciansCache = [];
let linesCache = [];

async function refreshToolsCache() {
  toolsCache = await api('GET', '/api/tools');
  return toolsCache;
}
async function refreshTechniciansCache() {
  techniciansCache = await api('GET', '/api/technicians?active=true');
  return techniciansCache;
}
async function refreshLinesCache() {
  linesCache = await api('GET', '/api/lines');
  return linesCache;
}
function toolOptionsHtml(selectedId) {
  return toolsCache.map(t =>
    `<option value="${t.id}" ${String(t.id) === String(selectedId) ? 'selected' : ''}>${escapeHtml(t.code)} — ${escapeHtml(t.name)}</option>`
  ).join('');
}
function technicianOptionsHtml(selectedId) {
  return techniciansCache.map(t =>
    `<option value="${t.id}" ${String(t.id) === String(selectedId) ? 'selected' : ''}>${escapeHtml(t.name)}</option>`
  ).join('');
}
function lineOptionsHtml(selectedId) {
  return linesCache.map(l =>
    `<option value="${l.id}" ${String(l.id) === String(selectedId) ? 'selected' : ''}>${escapeHtml(l.name)}</option>`
  ).join('');
}
const SHIFTS = ['Turno 1', 'Turno 2', 'Turno 3'];
function shiftOptionsHtml(selected) {
  return '<option value="">— Sin definir —</option>' + SHIFTS.map(s =>
    `<option value="${s}" ${s === selected ? 'selected' : ''}>${s}</option>`
  ).join('');
}

/* ======================== Navigation ======================== */

const tabs = ['dashboard', 'tools', 'maintenance', 'calendar', 'config'];
const renderers = {
  dashboard: renderDashboard,
  tools: renderTools,
  maintenance: renderMaintenance,
  calendar: renderCalendar,
  config: renderConfig
};
const pageMeta = {
  dashboard: { title: 'Dashboard', sub: 'Estado general del herramental de proceso' },
  tools: { title: 'Herramientas', sub: 'Máquinas, herramientas y procesos que requieren mantenimiento' },
  maintenance: { title: 'Mantenimiento', sub: 'Programación y bitácora de mantenimiento preventivo' },
  calendar: { title: 'Calendario', sub: 'Programación de mantenimiento por frecuencia — vista mensual' },
  config: { title: 'Configuración', sub: 'Técnicos de manufactura y líneas de ensamble' }
};

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-item[data-tab]');
  if (!btn) return;
  goToTab(btn.dataset.tab);
});

function goToTab(tab) {
  tabs.forEach(t => {
    document.getElementById('tab-' + t).classList.toggle('hidden', t !== tab);
  });
  document.querySelectorAll('.nav-item[data-tab]').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  const meta = pageMeta[tab];
  document.getElementById('pageTitle').textContent = meta.title;
  document.getElementById('pageSub').textContent = meta.sub;
  closeNotifPanel();
  renderers[tab]().catch(err => toast(err.message, true));
}

/* ======================== Icons ======================== */

const ICONS = {
  box: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line>',
  check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 17"></polyline>',
  tool: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>',
  x: '<circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line>',
  alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>',
  clock: '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>',
  target: '<circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle>'
};
function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
}
function statTile(cls, iconName, value, label) {
  return `<div class="stat-tile ${cls}"><div class="icon">${icon(iconName)}</div><div><div class="n">${value}</div><div class="l">${label}</div></div></div>`;
}

/* ======================== Notifications ======================== */

let notifPanelOpen = false;

document.getElementById('btnNotifBell').addEventListener('click', async (e) => {
  e.stopPropagation();
  if (notifPanelOpen) return closeNotifPanel();
  await openNotifPanel();
});
document.addEventListener('click', (e) => {
  if (notifPanelOpen && !e.target.closest('.notif-wrap')) closeNotifPanel();
});
document.getElementById('btnMarkAllRead').addEventListener('click', async () => {
  await api('POST', '/api/notifications/read-all');
  await openNotifPanel();
  await refreshNotifBadge();
});

async function refreshNotifBadge() {
  const { unread } = await api('GET', '/api/notifications/count');
  const badge = document.getElementById('notifBadge');
  if (unread > 0) {
    badge.textContent = unread > 99 ? '99+' : unread;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

async function openNotifPanel() {
  const panel = document.getElementById('notifPanel');
  await refreshNotifBadge();
  const rows = await api('GET', '/api/notifications?limit=30');
  document.getElementById('notifList').innerHTML = rows.length ? rows.map(n => `
    <div class="notif-item type-${n.type} ${n.read ? '' : 'unread'}" data-id="${n.id}">
      <div class="dot"></div>
      <div>
        <div class="msg">${escapeHtml(n.message)}</div>
        <div class="when">${n.type === 'overdue' ? 'Vencido' : 'Próximo a vencer'} · ${escapeHtml(n.tool_code || '')}</div>
      </div>
    </div>`).join('') : `<div class="notif-empty">Sin notificaciones pendientes.</div>`;

  panel.querySelectorAll('.notif-item').forEach(el => {
    el.addEventListener('click', async () => {
      await api('POST', `/api/notifications/${el.dataset.id}/read`);
      el.classList.remove('unread');
      await refreshNotifBadge();
    });
  });

  panel.classList.remove('hidden');
  notifPanelOpen = true;
}
function closeNotifPanel() {
  document.getElementById('notifPanel').classList.add('hidden');
  notifPanelOpen = false;
}

/* ======================== DASHBOARD ======================== */

async function renderDashboard() {
  await Promise.all([refreshLinesCache(), refreshTechniciansCache()]);

  const lineSel = document.getElementById('dashLineFilter');
  const techSel = document.getElementById('dashTechFilter');
  const keepLine = lineSel.value, keepTech = techSel.value;
  lineSel.innerHTML = '<option value="">Todas</option>' + lineOptionsHtml(keepLine);
  techSel.innerHTML = '<option value="">Todos</option>' + technicianOptionsHtml(keepTech);
  lineSel.value = keepLine;
  techSel.value = keepTech;

  lineSel.onchange = loadDashboard;
  techSel.onchange = loadDashboard;

  await loadDashboard();
  await renderPmPanel();
  await renderTrendChart();
  await renderTechChart();
  await renderCategoryChart();
  await renderCostChart();
  await refreshNotifBadge();
}

async function renderCostChart() {
  const { by_line } = await api('GET', '/api/dashboard/by-cost');
  const el = document.getElementById('costChart');
  const rows = by_line.filter(r => r.n > 0);
  if (!rows.length) {
    el.innerHTML = `<div class="analytics-empty">Todavía no hay costos capturados en las herramientas.</div>`;
    return;
  }
  const maxCost = Math.max(...rows.map(r => r.total_cost || 0), 1);
  el.innerHTML = `<div class="tech-list cost-list">${rows.map(r => `
    <div class="tech-row">
      <span class="tech-name" title="${escapeHtml(r.line_name)}">${escapeHtml(r.line_name)}</span>
      <div class="tech-bar-track"><div class="tech-bar-fill" style="width:${Math.round((r.total_cost || 0) / maxCost * 100)}%"></div></div>
      <span class="tech-count">${r.n}</span>
      <span class="tech-pct neutral">${fmtMoney(r.total_cost)}</span>
    </div>`).join('')}</div>`;
}

async function loadDashboard() {
  const params = new URLSearchParams();
  const lineId = document.getElementById('dashLineFilter').value;
  const techId = document.getElementById('dashTechFilter').value;
  if (lineId) params.set('assembly_line_id', lineId);
  if (techId) params.set('assigned_technician_id', techId);

  const s = await api('GET', '/api/dashboard/summary?' + params.toString());
  const counts = s.tool_counts || {};

  document.getElementById('statGrid').innerHTML =
    statTile('', 'box', s.total_tools, 'Activos registrados') +
    statTile('good', 'check', counts.activo || 0, 'Activos operando') +
    statTile('warn', 'tool', counts.en_mantenimiento || 0, 'En mantenimiento') +
    statTile('bad', 'alert', s.overdue_count, 'Vencidas') +
    statTile('warn', 'clock', s.upcoming_count, 'Próximas a vencer') +
    statTile(s.compliance_pct === null ? '' : (s.compliance_pct >= 80 ? 'good' : s.compliance_pct >= 50 ? 'warn' : 'bad'), 'target', s.compliance_pct === null ? '—' : s.compliance_pct + '%', 'Cumplimiento (90 días)') +
    statTile('', 'box', fmtMoney(s.total_cost), 'Valor del herramental');

  document.getElementById('overdueBody').innerHTML = s.overdue.length ? s.overdue.map(r => `
    <tr>
      <td>${escapeHtml(r.tool_code)} — ${escapeHtml(r.tool_name)}</td>
      <td>${escapeHtml(r.maintenance_type)}</td>
      <td>${escapeHtml(r.line_name || '—')}</td>
      <td>${escapeHtml(r.technician_name || '—')}</td>
      <td class="mono">${fmtDate(r.next_due_date)}</td>
    </tr>`).join('') : `<tr class="empty-row"><td colspan="5">Sin mantenimientos vencidos</td></tr>`;

  document.getElementById('upcomingBody').innerHTML = s.upcoming.length ? s.upcoming.map(r => `
    <tr>
      <td>${escapeHtml(r.tool_code)} — ${escapeHtml(r.tool_name)}</td>
      <td>${escapeHtml(r.maintenance_type)}</td>
      <td>${escapeHtml(r.line_name || '—')}</td>
      <td>${escapeHtml(r.technician_name || '—')}</td>
      <td class="mono">${fmtDate(r.next_due_date)}</td>
    </tr>`).join('') : `<tr class="empty-row"><td colspan="5">Nada próximo a vencer</td></tr>`;

  document.getElementById('dashLogBody').innerHTML = s.recent_logs.length ? s.recent_logs.map(l => `
    <tr>
      <td>${escapeHtml(l.tool_code)} — ${escapeHtml(l.tool_name)}</td>
      <td>${escapeHtml(l.maintenance_type)}</td>
      <td>${escapeHtml(l.technician_name || '—')}</td>
      <td class="mono">${fmtDate(l.performed_date)}</td>
      <td>${onTimeBadge(l.on_time)}</td>
    </tr>`).join('') : `<tr class="empty-row"><td colspan="5">Sin mantenimientos registrados</td></tr>`;
}

function fmtMonthLabel(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  const names = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${names[m - 1]} ${y}`;
}

async function renderPmPanel() {
  const data = await api('GET', '/api/dashboard/by-line');
  const el = document.getElementById('pmPanel');
  document.getElementById('pmPeriod').textContent = data.month_start ? fmtMonthLabel(data.month_start) : '';

  const lines = data.lines;
  if (!lines.length) {
    el.innerHTML = `<div class="pm-empty">Todavía no hay líneas de ensamble configuradas. Créalas en Configuración → Líneas de ensamble.</div>`;
    return;
  }

  const R = 30; // radio del anillo
  const CIRC = 2 * Math.PI * R;

  el.innerHTML = `<div class="pm-grid">${lines.map(l => {
    const pct = l.required_month > 0 ? Math.round((l.completed_month / l.required_month) * 100) : (l.total === 0 ? null : 100);
    const accentVar = pct === null ? '--viz-neutral' : pct >= 80 ? '--viz-good' : pct >= 50 ? '--viz-warn' : '--viz-bad';
    const frac = l.required_month > 0 ? Math.min(1, l.completed_month / l.required_month) : (l.total === 0 ? 0 : 1);
    const dashOffset = CIRC * (1 - frac);

    const alerts = [];
    if (l.overdue) alerts.push(`<span class="badge badge-overdue">${l.overdue} vencida${l.overdue > 1 ? 's' : ''}</span>`);
    if (l.upcoming) alerts.push(`<span class="badge badge-upcoming">${l.upcoming} próxima${l.upcoming > 1 ? 's' : ''}</span>`);
    if (!l.overdue && !l.upcoming && l.total > 0) alerts.push(`<span class="badge badge-ok">Al día</span>`);
    if (l.total === 0) alerts.push(`<span class="muted" style="font-size:0.75rem;">Sin programaciones activas</span>`);

    return `
      <div class="pm-card" style="--pm-accent:var(${accentVar})">
        <div class="pm-ring-wrap">
          <svg viewBox="0 0 76 76">
            <circle class="pm-ring-track" cx="38" cy="38" r="${R}"></circle>
            <circle class="pm-ring-fill" cx="38" cy="38" r="${R}"
              stroke-dasharray="${CIRC}" stroke-dashoffset="${dashOffset}"></circle>
          </svg>
          <div class="pm-ring-pct">${pct !== null ? pct + '%' : '—'}</div>
        </div>
        <div class="pm-card-body">
          <div class="pm-card-header">
            <span class="line-name">${escapeHtml(l.line_name)}</span>
          </div>
          <div class="pm-card-counts">
            <span class="required">Requeridos: <strong>${l.required_month}</strong></span>
            <span class="completed">Realizados: <strong>${l.completed_month}</strong></span>
          </div>
          <div class="pm-alerts">${alerts.join('')}</div>
        </div>
      </div>`;
  }).join('')}</div>
  ${data.unassigned_tools ? `<div class="pm-empty">${data.unassigned_tools} herramienta(s) sin línea asignada — no aparecen en este panel.</div>` : ''}`;
}

function pctClass(pct) {
  if (pct === null || pct === undefined) return 'neutral';
  return pct >= 80 ? 'good' : pct >= 50 ? 'warn' : 'bad';
}

async function renderTrendChart() {
  const { trend } = await api('GET', '/api/dashboard/trend');
  const el = document.getElementById('trendChart');
  if (!trend.some(t => t.total > 0)) {
    el.innerHTML = `<div class="analytics-empty">Todavía no hay mantenimientos registrados para calcular la tendencia.</div>`;
    return;
  }
  el.innerHTML = `<div class="trend-chart">${trend.map(t => {
    const pct = t.pct_on_time;
    const heightPct = pct === null ? 4 : Math.max(4, pct);
    const color = pct === null ? 'var(--viz-neutral)' : pct >= 80 ? 'var(--viz-good)' : pct >= 50 ? 'var(--viz-warn)' : 'var(--viz-bad)';
    return `
      <div class="trend-col">
        <div class="trend-value">${pct === null ? '—' : pct + '%'}</div>
        <div class="trend-bar-track"><div class="trend-bar-fill" style="height:${heightPct}%; background:${color};"></div></div>
        <div class="trend-label">${escapeHtml(t.label)}</div>
      </div>`;
  }).join('')}</div>`;
}

async function renderTechChart() {
  const { technicians } = await api('GET', '/api/dashboard/by-technician');
  const el = document.getElementById('techChart');
  if (!technicians.length) {
    el.innerHTML = `<div class="analytics-empty">Todavía no hay mantenimientos registrados con técnico asignado.</div>`;
    return;
  }
  const maxTotal = Math.max(...technicians.map(t => t.total), 1);
  el.innerHTML = `<div class="tech-list">${technicians.map(t => `
    <div class="tech-row">
      <span class="tech-name" title="${escapeHtml(t.technician_name)}">${escapeHtml(t.technician_name)}</span>
      <div class="tech-bar-track"><div class="tech-bar-fill" style="width:${Math.max(4, (t.total / maxTotal) * 100)}%"></div></div>
      <span class="tech-count">${t.total}</span>
      <span class="tech-pct ${pctClass(t.pct_on_time)}">${t.pct_on_time === null ? '—' : t.pct_on_time + '%'}</span>
    </div>`).join('')}</div>`;
}

async function renderCategoryChart() {
  const { categories } = await api('GET', '/api/dashboard/by-category');
  const el = document.getElementById('categoryChart');
  if (!categories.some(c => c.total > 0)) {
    el.innerHTML = `<div class="analytics-empty">Todavía no hay programaciones activas para desglosar por categoría.</div>`;
    return;
  }
  const R = 26, CIRC = 2 * Math.PI * R;
  el.innerHTML = `<div class="cat-grid">${categories.map(c => {
    const pct = c.required_month > 0 ? Math.round((c.completed_month / c.required_month) * 100) : (c.total === 0 ? null : 100);
    const accentVar = pct === null ? '--viz-neutral' : pct >= 80 ? '--viz-good' : pct >= 50 ? '--viz-warn' : '--viz-bad';
    const frac = c.required_month > 0 ? Math.min(1, c.completed_month / c.required_month) : (c.total === 0 ? 0 : 1);
    const dashOffset = CIRC * (1 - frac);
    return `
      <div class="cat-item">
        <div class="pm-ring-wrap sm" style="--pm-accent:var(${accentVar})">
          <svg viewBox="0 0 64 64">
            <circle class="pm-ring-track" cx="32" cy="32" r="${R}"></circle>
            <circle class="pm-ring-fill" cx="32" cy="32" r="${R}" stroke-dasharray="${CIRC}" stroke-dashoffset="${dashOffset}"></circle>
          </svg>
          <div class="pm-ring-pct">${pct !== null ? pct + '%' : '—'}</div>
        </div>
        <span class="cat-label">${categoryLabel(c.category)}</span>
        <span class="cat-sub">${c.completed_month}/${c.required_month}</span>
      </div>`;
  }).join('')}</div>`;
}

/* ======================== TOOLS ======================== */

let currentToolDetailId = null;
let toolDetailSub = 'sched';

async function renderTools() {
  await refreshLinesCache();
  await loadToolsTable();
}

async function loadToolsTable() {
  const q = document.getElementById('toolSearch').value.trim();
  const category = document.getElementById('toolCategoryFilter').value;
  const status = document.getElementById('toolStatusFilter').value;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (category) params.set('category', category);
  if (status) params.set('status', status);

  const rows = await api('GET', '/api/tools?' + params.toString());
  toolsCache = await api('GET', '/api/tools');

  document.getElementById('toolsBody').innerHTML = rows.length ? rows.map(t => `
    <tr>
      <td>${toolThumbHtml(t)}</td>
      <td class="mono">${escapeHtml(t.code)}</td>
      <td>${escapeHtml(t.name)}</td>
      <td>${categoryLabel(t.category)}</td>
      <td>${escapeHtml(t.line_name || '—')}</td>
      <td class="mono">${fmtMoney(t.cost)}</td>
      <td>${statusBadge(t.status)}</td>
      <td class="row-actions">
        <button class="btn-icon" data-action="view" data-id="${t.id}" title="Ver detalle">👁️</button>
        ${isAdmin() ? `<button class="btn-icon" data-action="edit" data-id="${t.id}" title="Editar">✏️</button>
        <button class="btn-icon btn-icon-danger" data-action="delete" data-id="${t.id}" title="Eliminar">🗑️</button>` : ''}
      </td>
    </tr>`).join('') : `<tr class="empty-row"><td colspan="8">Sin resultados. Crea el primero con "+ Nueva herramienta".</td></tr>`;
}

document.getElementById('toolSearch').addEventListener('input', debounce(loadToolsTable, 250));
document.getElementById('toolCategoryFilter').addEventListener('change', loadToolsTable);
document.getElementById('toolStatusFilter').addEventListener('change', loadToolsTable);

document.getElementById('toolsBody').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;

  if (action === 'view') return openToolDetail(id);
  if (action === 'edit') return openToolForm(await api('GET', `/api/tools/${id}`));
  if (action === 'delete') {
    if (!confirm('¿Eliminar este activo? También se eliminarán sus programaciones y bitácora.')) return;
    try {
      await api('DELETE', `/api/tools/${id}`);
      toast('Eliminado');
      await loadToolsTable();
      if (currentToolDetailId === id) document.getElementById('toolDetailCard').classList.add('hidden');
    } catch (err) { toast(err.message, true); }
  }
});

document.getElementById('btnNewTool').addEventListener('click', async () => {
  await refreshLinesCache();
  openToolForm(null);
});

document.getElementById('btnImportTools').addEventListener('click', () => openImportForm());

function openImportForm() {
  openModal('Importar herramientas desde Excel', `
    <p class="muted" style="font-size:0.82rem; margin-bottom:12px;">
      Columnas esperadas (la primera fila de tu archivo debe traer estos encabezados):
    </p>
    <div class="table-wrap" style="margin-bottom:14px;">
      <table style="font-size:0.72rem;"><thead><tr>
        <th>No. de Parte</th><th>Descripción</th><th>Categoría</th><th>Línea</th>
        <th>Frecuencia (días)</th><th>Técnico Asignado</th><th>Costo Aproximado (USD)</th><th>Ubicación</th><th>Estado</th>
      </tr></thead></table>
    </div>
    <p class="muted" style="font-size:0.76rem; margin-bottom:14px;">
      Categoría: maquina, herramienta, proceso o equipo. Si viene "Frecuencia (días)" se crea también su primera programación de mantenimiento. Las líneas y técnicos se emparejan por nombre; si no existen, la fila se importa sin esa relación.
    </p>
    <div class="field"><label>Archivo (.xlsx, .xls o .csv)</label><input type="file" id="importFileInput" accept=".xlsx,.xls,.csv"></div>
    <div id="importResult"></div>
    <div class="form-actions">
      <button type="button" class="btn btn-secondary" id="importCancel">Cerrar</button>
      <button type="button" class="btn btn-primary" id="importSubmit">Importar</button>
    </div>
  `, true);
  document.getElementById('importCancel').addEventListener('click', closeModal);
  document.getElementById('importSubmit').addEventListener('click', async () => {
    const file = document.getElementById('importFileInput').files[0];
    if (!file) return toast('Selecciona un archivo primero', true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch('/api/tools/import', { method: 'POST', body: fd });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data && data.error) || `Error ${res.status}`);
      const errs = data.errors || [];
      document.getElementById('importResult').innerHTML = `
        <div class="login-error" style="background:var(--success-bg, var(--surface-2)); color:var(--text); margin-top:10px;">
          ${data.created} herramienta(s) importada(s)${errs.length ? `, ${errs.length} fila(s) con error` : ''}.
        </div>
        ${errs.length ? `<ul style="font-size:0.76rem; color:var(--critical); margin-top:6px;">${errs.map(e2 => `<li>Fila ${e2.row}: ${escapeHtml(e2.error)}</li>`).join('')}</ul>` : ''}
      `;
      toast(`${data.created} herramienta(s) importada(s)`);
      await loadToolsTable();
    } catch (err) { toast(err.message, true); }
  });
}

function openToolForm(tool) {
  const isEdit = !!tool;
  openModal(isEdit ? 'Editar activo' : 'Nuevo activo (máquina, herramienta o proceso)', `
    <form id="toolForm">
      <div class="field-row">
        <div class="field"><label>Código</label><input name="code" required value="${escapeHtml(tool?.code || '')}"></div>
        <div class="field"><label>Nombre</label><input name="name" required value="${escapeHtml(tool?.name || '')}"></div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Categoría</label>
          <select name="category">
            <option value="maquina" ${tool?.category === 'maquina' ? 'selected' : ''}>Máquina</option>
            <option value="herramienta" ${!tool || tool?.category === 'herramienta' ? 'selected' : ''}>Herramienta</option>
            <option value="proceso" ${tool?.category === 'proceso' ? 'selected' : ''}>Proceso</option>
            <option value="equipo" ${tool?.category === 'equipo' ? 'selected' : ''}>Equipo</option>
          </select>
        </div>
        <div class="field"><label>Tipo (opcional)</label><input name="type" placeholder="Ej. Prensa hidráulica, troquel..." value="${escapeHtml(tool?.type || '')}"></div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Línea de ensamble</label>
          <select name="assembly_line_id">
            <option value="">— Sin línea —</option>
            ${lineOptionsHtml(tool?.assembly_line_id)}
          </select>
        </div>
        <div class="field"><label>Ubicación</label><input name="location" value="${escapeHtml(tool?.location || '')}"></div>
      </div>
      <div class="field"><label>Costo aproximado (USD)</label><input name="cost" type="number" min="0" step="0.01" value="${tool?.cost ?? ''}"></div>
      <div class="field">
        <label>Estado</label>
        <select name="status">
          <option value="activo" ${!tool || tool?.status === 'activo' ? 'selected' : ''}>Activo</option>
          <option value="en_mantenimiento" ${tool?.status === 'en_mantenimiento' ? 'selected' : ''}>En mantenimiento</option>
          <option value="baja" ${tool?.status === 'baja' ? 'selected' : ''}>Baja</option>
        </select>
      </div>
      <div class="field"><label>Notas</label><textarea name="notes">${escapeHtml(tool?.notes || '')}</textarea></div>
      <div class="field">
        <label>Fotografía del equipo, herramienta o fixture (opcional)</label>
        <div id="toolPhotoPreviewWrap">${isEdit && toolPhotoUrl(tool) ? `<img class="tool-photo-preview" src="${toolPhotoUrl(tool)}" alt="">` : ''}</div>
        <input type="file" id="toolPhotoInput" accept="image/jpeg,image/png,image/webp">
        ${isEdit && tool.photo_filename ? `<button type="button" class="btn btn-secondary btn-sm" id="toolPhotoRemoveBtn" style="margin-top:6px;">Quitar foto actual</button>` : ''}
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" id="toolFormCancel">Cancelar</button>
        <button type="submit" class="btn btn-primary">${isEdit ? 'Guardar cambios' : 'Crear'}</button>
      </div>
    </form>
  `);
  document.getElementById('toolFormCancel').addEventListener('click', closeModal);
  const removeBtn = document.getElementById('toolPhotoRemoveBtn');
  if (removeBtn) {
    removeBtn.addEventListener('click', async () => {
      await removeToolPhoto(tool.id, async () => {
        document.getElementById('toolPhotoPreviewWrap').innerHTML = '';
        removeBtn.remove();
        await loadToolsTable();
      });
    });
  }
  document.getElementById('toolForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    try {
      const saved = isEdit ? await api('PUT', `/api/tools/${tool.id}`, payload) : await api('POST', '/api/tools', payload);
      const photoFile = document.getElementById('toolPhotoInput').files[0];
      if (photoFile) {
        const photoFd = new FormData();
        photoFd.append('photo', photoFile);
        const photoRes = await fetch(`/api/tools/${saved.id}/photo`, { method: 'POST', body: photoFd });
        if (!photoRes.ok) {
          const photoData = await photoRes.json().catch(() => null);
          toast(`${isEdit ? 'Activo actualizado' : 'Activo creado'}, pero falló la foto: ${(photoData && photoData.error) || 'error desconocido'}`, true);
          closeModal();
          await loadToolsTable();
          return;
        }
      }
      toast(isEdit ? 'Activo actualizado' : 'Activo creado');
      closeModal();
      await loadToolsTable();
    } catch (err) { toast(err.message, true); }
  });
}

async function openToolDetail(id) {
  currentToolDetailId = id;
  toolDetailSub = 'sched';
  const tool = await api('GET', `/api/tools/${id}`);
  document.getElementById('toolDetailTitle').textContent = `${tool.code} — ${tool.name}`;
  document.getElementById('toolDetailPhoto').innerHTML = `
    ${toolPhotoUrl(tool) ? `<img class="tool-photo-preview tool-photo-preview-lg" src="${toolPhotoUrl(tool)}" alt="">` : `<div class="tool-thumb tool-thumb-placeholder tool-thumb-lg">${categoryIcon(tool.category)}</div>`}
    <div class="tool-photo-actions">
      <button type="button" class="btn btn-secondary btn-sm" id="toolDetailPhotoBtn">${tool.photo_filename ? 'Cambiar foto' : '+ Foto'}</button>
      ${tool.photo_filename ? `<button type="button" class="btn btn-secondary btn-sm" id="toolDetailPhotoRemoveBtn">Quitar</button>` : ''}
    </div>
  `;
  document.getElementById('toolDetailPhotoBtn').addEventListener('click', () => pickAndUploadPhoto(tool.id, () => openToolDetail(id)));
  const detailRemoveBtn = document.getElementById('toolDetailPhotoRemoveBtn');
  if (detailRemoveBtn) detailRemoveBtn.addEventListener('click', () => removeToolPhoto(tool.id, () => openToolDetail(id)));
  document.getElementById('toolDetailMeta').innerHTML = `
    <span class="chip">Categoría: <strong>${categoryLabel(tool.category)}</strong></span>
    <span class="chip">Línea: <strong>${escapeHtml(tool.line_name || 'Sin asignar')}</strong></span>
    <span class="chip">Ubicación: <strong>${escapeHtml(tool.location || '—')}</strong></span>
    <span class="chip">Costo: <strong>${fmtMoney(tool.cost)}</strong></span>
    <span class="chip">Estado: <strong>${categoryLabelStatus(tool.status)}</strong></span>
  `;
  document.getElementById('toolDetailCard').classList.remove('hidden');
  document.querySelectorAll('#toolDetailCard .subtab-btn').forEach(b => b.classList.toggle('active', b.dataset.sub === 'sched'));
  await renderToolDetailBody();
  document.getElementById('toolDetailCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function categoryLabelStatus(status) {
  const labels = { activo: 'Activo', en_mantenimiento: 'En mantenimiento', baja: 'Baja' };
  return labels[status] || status;
}

document.getElementById('btnCloseToolDetail').addEventListener('click', () => {
  document.getElementById('toolDetailCard').classList.add('hidden');
  currentToolDetailId = null;
});

document.querySelectorAll('#toolDetailCard .subtab-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    toolDetailSub = btn.dataset.sub;
    document.querySelectorAll('#toolDetailCard .subtab-btn').forEach(b => b.classList.toggle('active', b === btn));
    await renderToolDetailBody();
  });
});

async function renderToolDetailBody() {
  const id = currentToolDetailId;
  const body = document.getElementById('toolDetailBody');
  if (toolDetailSub === 'sched') {
    const rows = await api('GET', `/api/tools/${id}/schedules`);
    body.innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Tipo</th><th>Técnico</th><th>Turno</th><th>Frecuencia</th><th>Próxima</th><th>Estado</th></tr></thead><tbody>${
      rows.map(s => `<tr><td>${escapeHtml(s.maintenance_type)}</td><td>${escapeHtml(s.technician_name || '—')}</td><td>${escapeHtml(s.shift || '—')}</td><td>${s.frequency_days} días</td><td class="mono">${fmtDate(s.next_due_date)}</td><td>${s.active ? dueBadge(s.next_due_date) : '<span class="badge">Inactiva</span>'}</td></tr>`).join('')
    }</tbody></table></div>` : `<p class="muted">Sin programaciones para este activo.</p>`;
  } else {
    const rows = await api('GET', `/api/tools/${id}/logs`);
    body.innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Técnico</th><th>Turno</th><th>A tiempo</th><th>Descripción</th><th>Evidencia</th></tr></thead><tbody>${
      rows.map(l => `<tr><td class="mono">${fmtDate(l.performed_date)}</td><td>${escapeHtml(l.maintenance_type)}</td><td>${escapeHtml(l.technician_name || '—')}</td><td>${escapeHtml(l.shift || '—')}</td><td>${onTimeBadge(l.on_time)}</td><td>${escapeHtml(l.description || '—')}</td><td>${evidenceButtonHtml(l)}</td></tr>`).join('')
    }</tbody></table></div>` : `<p class="muted">Sin mantenimientos registrados para este activo.</p>`;
    body.querySelectorAll('button[data-action="attach-evidence"]').forEach(btn => {
      btn.addEventListener('click', () => pickAndUploadEvidence(btn.dataset.id, renderToolDetailBody));
    });
  }
}

/* ======================== MAINTENANCE ======================== */

let maintSub = 'schedules';

async function renderMaintenance() {
  await Promise.all([refreshToolsCache(), refreshTechniciansCache(), refreshLinesCache()]);

  const lineSel = document.getElementById('scheduleLineFilter');
  const techSel = document.getElementById('scheduleTechFilter');
  lineSel.innerHTML = '<option value="">Todas</option>' + lineOptionsHtml();
  techSel.innerHTML = '<option value="">Todos</option>' + technicianOptionsHtml();

  await loadSchedules();
  await loadLogs();
}

document.querySelectorAll('#tab-maintenance .subtabs .subtab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    maintSub = btn.dataset.msub;
    document.querySelectorAll('#tab-maintenance .subtabs .subtab-btn').forEach(b => b.classList.toggle('active', b === btn));
    document.getElementById('msub-schedules').classList.toggle('hidden', maintSub !== 'schedules');
    document.getElementById('msub-logs').classList.toggle('hidden', maintSub !== 'logs');
  });
});

document.getElementById('scheduleFilter').addEventListener('change', loadSchedules);
document.getElementById('scheduleLineFilter').addEventListener('change', loadSchedules);
document.getElementById('scheduleTechFilter').addEventListener('change', loadSchedules);

async function loadSchedules() {
  const due = document.getElementById('scheduleFilter').value;
  const lineId = document.getElementById('scheduleLineFilter').value;
  const techId = document.getElementById('scheduleTechFilter').value;
  const params = new URLSearchParams();
  if (due) params.set('due', due); else params.set('active', 'true');
  if (lineId) params.set('assembly_line_id', lineId);
  if (techId) params.set('assigned_technician_id', techId);
  const rows = await api('GET', '/api/maintenance/schedules?' + params.toString());

  document.getElementById('schedulesBody').innerHTML = rows.length ? rows.map(s => `
    <tr>
      <td>${escapeHtml(s.tool_code)} — ${escapeHtml(s.tool_name)}</td>
      <td>${escapeHtml(s.maintenance_type)}</td>
      <td>${escapeHtml(s.line_name || '—')}</td>
      <td>${escapeHtml(s.technician_name || '—')}</td>
      <td>${escapeHtml(s.shift || '—')}</td>
      <td class="mono">${fmtDate(s.next_due_date)}</td>
      <td>${dueBadge(s.next_due_date)}</td>
      <td class="row-actions">${isAdmin() ? `
        <button class="btn btn-secondary btn-sm" data-action="edit-sched" data-id="${s.id}">Editar</button>
        <button class="btn btn-danger btn-sm" data-action="delete-sched" data-id="${s.id}">Eliminar</button>` : '<span class="muted">—</span>'}
      </td>
    </tr>`).join('') : `<tr class="empty-row"><td colspan="8">Sin programaciones para este filtro.</td></tr>`;
}

document.getElementById('schedulesBody').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.action === 'delete-sched') {
    if (!confirm('¿Eliminar esta programación?')) return;
    await api('DELETE', `/api/maintenance/schedules/${id}`);
    toast('Programación eliminada');
    await loadSchedules();
  } else if (btn.dataset.action === 'edit-sched') {
    const s = await api('GET', `/api/maintenance/schedules/${id}`);
    openScheduleForm(s);
  }
});

document.getElementById('btnNewSchedule').addEventListener('click', () => openScheduleForm(null));

function checklistRowHtml(desc) {
  return `<div class="checklist-row"><input type="text" name="checklist_item" placeholder="Ej. Revisar nivel de aceite" value="${escapeHtml(desc || '')}"><button type="button" class="btn btn-secondary btn-sm remove-checklist-row">✕</button></div>`;
}

function openScheduleForm(schedule) {
  const isEdit = !!schedule;
  const checklistItems = schedule?.checklist?.length ? schedule.checklist.map(c => c.description) : [''];

  openModal(isEdit ? 'Editar programación' : 'Nueva programación de mantenimiento preventivo', `
    <form id="schedForm">
      <div class="field">
        <label>Máquina, herramienta o proceso</label>
        <select name="tool_id" ${isEdit ? 'disabled' : ''} required>
          <option value="">Selecciona...</option>
          ${toolOptionsHtml(schedule?.tool_id)}
        </select>
      </div>
      <div class="field"><label>Tipo de mantenimiento</label><input name="maintenance_type" required placeholder="Calibración, lubricación, limpieza..." value="${escapeHtml(schedule?.maintenance_type || '')}"></div>
      <div class="field-row">
        <div class="field"><label>Frecuencia (días)</label><input name="frequency_days" type="number" min="1" required value="${schedule?.frequency_days || 30}"></div>
        <div class="field"><label>Alertar con anticipación (días)</label><input name="alert_days_before" type="number" min="0" required value="${schedule?.alert_days_before ?? 7}"></div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Técnico asignado</label>
          <select name="assigned_technician_id">
            <option value="">— Sin asignar —</option>
            ${technicianOptionsHtml(schedule?.assigned_technician_id)}
          </select>
        </div>
        <div class="field">
          <label>Turno</label>
          <select name="shift">${shiftOptionsHtml(schedule?.shift)}</select>
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label>Última realizada</label><input name="last_done_date" type="date" value="${fmtDate(schedule?.last_done_date) === '—' ? '' : fmtDate(schedule?.last_done_date)}"></div>
        ${isEdit ? `<div class="field"><label>Próxima fecha</label><input name="next_due_date" type="date" value="${fmtDate(schedule.next_due_date)}"></div>` : ''}
      </div>
      ${isEdit ? `<div class="field"><label><input type="checkbox" name="active" value="1" style="width:auto;display:inline-block;margin-right:6px;" ${schedule.active ? 'checked' : ''}> Programación activa</label></div>` : ''}
      <div class="field"><label>Notas</label><textarea name="notes">${escapeHtml(schedule?.notes || '')}</textarea></div>

      <div class="field">
        <label>Checklist a realizar</label>
        <div class="checklist-builder" id="checklistBuilder">${checklistItems.map(checklistRowHtml).join('')}</div>
        <button type="button" class="btn btn-secondary btn-sm" id="btnAddChecklistRow">+ Agregar ítem</button>
      </div>

      <div class="form-actions">
        <button type="button" class="btn btn-secondary" id="schedCancel">Cancelar</button>
        <button type="submit" class="btn btn-primary">${isEdit ? 'Guardar cambios' : 'Crear'}</button>
      </div>
    </form>
  `);

  document.getElementById('btnAddChecklistRow').addEventListener('click', () => {
    document.getElementById('checklistBuilder').insertAdjacentHTML('beforeend', checklistRowHtml(''));
  });
  document.getElementById('checklistBuilder').addEventListener('click', (e) => {
    const rm = e.target.closest('.remove-checklist-row');
    if (rm) rm.closest('.checklist-row').remove();
  });

  document.getElementById('schedCancel').addEventListener('click', closeModal);
  document.getElementById('schedForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const payload = Object.fromEntries(new FormData(form).entries());
    if (isEdit) payload.active = form.elements.active && form.elements.active.checked ? 1 : 0;
    payload.checklist = Array.from(form.querySelectorAll('[name="checklist_item"]')).map(el => el.value.trim()).filter(Boolean);
    try {
      if (isEdit) await api('PUT', `/api/maintenance/schedules/${schedule.id}`, payload);
      else await api('POST', '/api/maintenance/schedules', payload);
      toast(isEdit ? 'Programación actualizada' : 'Programación creada');
      closeModal();
      await loadSchedules();
    } catch (err) { toast(err.message, true); }
  });
}

async function loadLogs() {
  const rows = await api('GET', '/api/maintenance/logs?limit=50');
  document.getElementById('logsBody').innerHTML = rows.length ? rows.map(l => `
    <tr>
      <td>${escapeHtml(l.tool_code)} — ${escapeHtml(l.tool_name)}</td>
      <td>${escapeHtml(l.maintenance_type)}</td>
      <td>${escapeHtml(l.technician_name || '—')}</td>
      <td>${escapeHtml(l.shift || '—')}</td>
      <td class="mono">${fmtDate(l.performed_date)}</td>
      <td>${onTimeBadge(l.on_time)}</td>
      <td class="row-actions">${evidenceButtonHtml(l)}${isAdmin() ? `<button class="btn btn-danger btn-sm" data-action="delete-log" data-id="${l.id}">Eliminar</button>` : ''}</td>
    </tr>`).join('') : `<tr class="empty-row"><td colspan="7">Sin mantenimientos registrados.</td></tr>`;
}

document.getElementById('logsBody').addEventListener('click', async (e) => {
  const delBtn = e.target.closest('button[data-action="delete-log"]');
  if (delBtn) {
    if (!confirm('¿Eliminar este registro de mantenimiento?')) return;
    await api('DELETE', `/api/maintenance/logs/${delBtn.dataset.id}`);
    toast('Registro eliminado');
    await loadLogs();
    return;
  }
  const attachBtn = e.target.closest('button[data-action="attach-evidence"]');
  if (attachBtn) pickAndUploadEvidence(attachBtn.dataset.id, loadLogs);
});

document.getElementById('btnNewLog').addEventListener('click', () => openLogForm());

function renderLogChecklist(items) {
  const container = document.getElementById('logChecklistContainer');
  if (!items || !items.length) {
    container.innerHTML = '<p class="muted" style="font-size:0.8rem;">Esta programación no tiene checklist definido, o no seleccionaste una programación.</p>';
    return;
  }
  container.innerHTML = `<div class="checklist-run">${items.map(it => `
    <div class="checklist-run-item" data-item-id="${it.id}" data-desc="${escapeHtml(it.description)}">
      <label class="chk"><input type="checkbox" class="chk-completed" checked> ${escapeHtml(it.description)}</label>
      <input type="text" class="chk-notes" placeholder="Notas (opcional)">
    </div>`).join('')}</div>`;
}

async function populateSchedulesForTool(toolId) {
  const schedSel = document.getElementById('logScheduleSelect');
  schedSel.innerHTML = '<option value="">— Ninguna —</option>';
  renderLogChecklist(null);
  if (!toolId) return;
  const scheds = await api('GET', `/api/tools/${toolId}/schedules`);
  scheds.filter(s => s.active && (!isTecnico() || String(s.assigned_technician_id) === String(currentUser.technician_id))).forEach(s => {
    schedSel.innerHTML += `<option value="${s.id}" data-type="${escapeHtml(s.maintenance_type)}" data-tech="${s.assigned_technician_id || ''}" data-shift="${escapeHtml(s.shift || '')}">${escapeHtml(s.maintenance_type)} (vence ${fmtDate(s.next_due_date)})</option>`;
  });
}

async function applyScheduleSelection(scheduleId) {
  if (!scheduleId) { renderLogChecklist(null); return; }
  const opt = document.querySelector(`#logScheduleSelect option[value="${scheduleId}"]`);
  if (opt) {
    if (opt.dataset.type) document.getElementById('logTypeInput').value = opt.dataset.type;
    if (opt.dataset.tech) document.getElementById('logTechnicianSelect').value = opt.dataset.tech;
    if (opt.dataset.shift) document.getElementById('logShiftSelect').value = opt.dataset.shift;
  }
  const detail = await api('GET', `/api/maintenance/schedules/${scheduleId}`);
  renderLogChecklist(detail.checklist);
}

async function openLogForm(preset) {
  openModal('Registrar mantenimiento realizado', `
    <form id="logForm">
      <div class="field">
        <label>Máquina, herramienta o proceso</label>
        <select name="tool_id" id="logToolSelect" required>
          <option value="">Selecciona...</option>
          ${toolOptionsHtml()}
        </select>
      </div>
      <div class="field">
        <label>Programación relacionada (opcional — actualiza la próxima fecha y trae el checklist)</label>
        <select name="schedule_id" id="logScheduleSelect"><option value="">— Ninguna —</option></select>
      </div>
      <div class="field-row">
        <div class="field"><label>Tipo de mantenimiento</label><input name="maintenance_type" required placeholder="Calibración, lubricación..." id="logTypeInput"></div>
        <div class="field"><label>Fecha realizada</label><input name="performed_date" type="date" value="${todayStr()}"></div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Técnico</label>
          ${isTecnico()
            ? `<input type="text" value="${escapeHtml(currentUser.username)}" disabled><input type="hidden" name="technician_id" id="logTechnicianSelect" value="${currentUser.technician_id || ''}">`
            : `<select name="technician_id" id="logTechnicianSelect">
                <option value="">— Sin asignar —</option>
                ${technicianOptionsHtml()}
              </select>`}
        </div>
        <div class="field">
          <label>Turno</label>
          <select name="shift" id="logShiftSelect">${shiftOptionsHtml()}</select>
        </div>
      </div>
      <div class="field"><label>Descripción</label><textarea name="description"></textarea></div>
      <div class="field"><label>Repuestos / partes usadas</label><textarea name="parts_used"></textarea></div>

      <div class="field">
        <label>Checklist realizado</label>
        <div id="logChecklistContainer"></div>
      </div>

      <div class="field">
        <label>Evidencia (PDF, opcional)</label>
        <input type="file" id="logEvidenceInput" accept="application/pdf">
      </div>

      <div class="form-actions">
        <button type="button" class="btn btn-secondary" id="logCancel">Cancelar</button>
        <button type="submit" class="btn btn-primary">Guardar</button>
      </div>
    </form>
  `);

  renderLogChecklist(null);
  document.getElementById('logCancel').addEventListener('click', closeModal);

  document.getElementById('logToolSelect').addEventListener('change', (e) => populateSchedulesForTool(e.target.value));
  document.getElementById('logScheduleSelect').addEventListener('change', (e) => applyScheduleSelection(e.target.value));

  if (preset && preset.toolId) {
    document.getElementById('logToolSelect').value = preset.toolId;
    await populateSchedulesForTool(preset.toolId);
    if (preset.scheduleId) {
      document.getElementById('logScheduleSelect').value = preset.scheduleId;
      await applyScheduleSelection(preset.scheduleId);
    }
  }

  document.getElementById('logForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(e.target).entries());
    if (!payload.schedule_id) delete payload.schedule_id;
    payload.checklist = Array.from(document.querySelectorAll('#logChecklistContainer .checklist-run-item')).map(row => ({
      checklist_item_id: Number(row.dataset.itemId),
      description: row.dataset.desc,
      completed: row.querySelector('.chk-completed').checked,
      notes: row.querySelector('.chk-notes').value.trim() || undefined
    }));
    try {
      const created = await api('POST', '/api/maintenance/logs', payload);
      const file = document.getElementById('logEvidenceInput').files[0];
      if (file) {
        const evFd = new FormData();
        evFd.append('evidence', file);
        const evRes = await fetch(`/api/maintenance/logs/${created.id}/evidence`, { method: 'POST', body: evFd });
        if (!evRes.ok) {
          const evData = await evRes.json().catch(() => null);
          toast('Mantenimiento registrado, pero falló la evidencia: ' + ((evData && evData.error) || 'error desconocido'), true);
          closeModal();
          await loadLogs();
          await loadSchedules();
          return;
        }
      }
      toast('Mantenimiento registrado');
      closeModal();
      await loadLogs();
      await loadSchedules();
    } catch (err) { toast(err.message, true); }
  });
}

/* ======================== CALENDARIO ======================== */

let calYear, calMonth, calMode = 'programado';
(function initCalendarState() {
  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();
})();

const CATEGORY_COLORS = { maquina: 'var(--brand)', herramienta: 'var(--viz-good)', proceso: 'var(--viz-warn)', equipo: 'var(--viz-neutral)' };
function categoryColor(cat) { return CATEGORY_COLORS[cat] || 'var(--viz-neutral)'; }

let calendarEventsByDate = {};

function isoDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function loadCalendarData() {
  calendarEventsByDate = {};
  if (calMode === 'programado') {
    const rows = await api('GET', '/api/maintenance/schedules?active=true');
    rows.forEach(s => {
      const key = s.next_due_date;
      (calendarEventsByDate[key] = calendarEventsByDate[key] || []).push({
        tool_id: s.tool_id, tool_code: s.tool_code, tool_name: s.tool_name, category: s.tool_category,
        maintenance_type: s.maintenance_type, technician_name: s.technician_name, schedule_id: s.id, done: false
      });
    });
  } else {
    const rows = await api('GET', '/api/maintenance/logs?limit=500');
    rows.forEach(l => {
      const key = l.performed_date;
      (calendarEventsByDate[key] = calendarEventsByDate[key] || []).push({
        tool_id: l.tool_id, tool_code: l.tool_code, tool_name: l.tool_name, category: l.tool_category,
        maintenance_type: l.maintenance_type, technician_name: l.technician_name, on_time: l.on_time, done: true
      });
    });
  }
}

function renderCalendarGrid() {
  const y = calYear, m = calMonth;
  const first = new Date(y, m, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const prevDays = new Date(y, m, 0).getDate();
  const cells = [];
  for (let i = startDow - 1; i >= 0; i--) cells.push({ d: prevDays - i, date: new Date(y, m - 1, prevDays - i), other: true });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ d, date: new Date(y, m, d), other: false });
  while (cells.length % 7 !== 0 || cells.length < 42) {
    const nextD = cells.length - startDow - daysInMonth + 1;
    cells.push({ d: nextD, date: new Date(y, m + 1, nextD), other: true });
  }

  const monthNames = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  document.getElementById('calMonthLabel').textContent = `${monthNames[m]} ${y}`;

  const todayKey = todayStr();
  document.getElementById('calGrid').innerHTML =
    ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map(d => `<div class="cal-dow">${d}</div>`).join('') +
    cells.map(c => {
      const key = isoDate(c.date);
      const dayEvents = calendarEventsByDate[key] || [];
      const isToday = key === todayKey;
      return `<div class="cal-day ${c.other ? 'other-month' : ''} ${isToday ? 'today' : ''}" data-cal-day="${key}">
        <div class="num">${c.d}</div>
        ${dayEvents.slice(0, 3).map(e => `<div class="cal-chip" style="background:${categoryColor(e.category)}">${e.done ? '✓ ' : ''}${escapeHtml(e.tool_code)}</div>`).join('')}
        ${dayEvents.length > 3 ? `<div class="cal-chip more">+${dayEvents.length - 3} más</div>` : ''}
      </div>`;
    }).join('');
}

async function refreshCalendar() {
  try {
    await loadCalendarData();
    renderCalendarGrid();
  } catch (err) { toast(err.message, true); }
}

async function renderCalendar() {
  await refreshCalendar();
}

document.getElementById('calPrev').addEventListener('click', () => {
  calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
  refreshCalendar();
});
document.getElementById('calNext').addEventListener('click', () => {
  calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
  refreshCalendar();
});
document.getElementById('calToday').addEventListener('click', () => {
  const now = new Date(); calYear = now.getFullYear(); calMonth = now.getMonth();
  refreshCalendar();
});
document.querySelectorAll('#tab-calendar .subtabs .subtab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    calMode = btn.dataset.calmode;
    document.querySelectorAll('#tab-calendar .subtabs .subtab-btn').forEach(b => b.classList.toggle('active', b === btn));
    refreshCalendar();
  });
});

document.getElementById('calGrid').addEventListener('click', (e) => {
  const cell = e.target.closest('.cal-day');
  if (cell) openCalendarDayModal(cell.dataset.calDay);
});

function openCalendarDayModal(dateKey) {
  const events = calendarEventsByDate[dateKey] || [];
  const rows = events.length ? events.map(e => `
    <tr>
      <td><span class="badge" style="background:${categoryColor(e.category)}22; color:${categoryColor(e.category)};">${categoryLabel(e.category)}</span></td>
      <td class="mono">${escapeHtml(e.tool_code)}</td>
      <td>${escapeHtml(e.tool_name)}</td>
      <td>${escapeHtml(e.maintenance_type)}</td>
      <td>${escapeHtml(e.technician_name || '—')}</td>
      <td>${e.done ? onTimeBadge(e.on_time) : (canCompleteMaintenance() ? `<button class="btn btn-primary btn-sm" data-action="cal-complete" data-tool="${e.tool_id}" data-schedule="${e.schedule_id || ''}">Completar</button>` : '<span class="muted">—</span>')}</td>
    </tr>`).join('') : `<tr class="empty-row"><td colspan="6">Sin mantenimientos este día.</td></tr>`;

  openModal(fmtDate(dateKey), `
    <div class="table-wrap"><table><thead><tr><th>Categoría</th><th>Código</th><th>Nombre</th><th>Tipo</th><th>Técnico</th><th>Acción</th></tr></thead><tbody>${rows}</tbody></table></div>
  `, true);

  modalBody.querySelectorAll('button[data-action="cal-complete"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const preset = { toolId: btn.dataset.tool, scheduleId: btn.dataset.schedule || undefined };
      closeModal();
      await openLogForm(preset);
    });
  });
}

/* ======================== CONFIG (técnicos / líneas) ======================== */

let configSub = 'technicians';

async function renderConfig() {
  await loadTechnicians();
  await loadLines();
  if (isAdmin()) await loadUsers();
}

document.querySelectorAll('#tab-config .subtabs .subtab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.classList.contains('hidden')) return;
    configSub = btn.dataset.csub;
    document.querySelectorAll('#tab-config .subtabs .subtab-btn').forEach(b => b.classList.toggle('active', b === btn));
    document.getElementById('csub-technicians').classList.toggle('hidden', configSub !== 'technicians');
    document.getElementById('csub-lines').classList.toggle('hidden', configSub !== 'lines');
    document.getElementById('csub-users').classList.toggle('hidden', configSub !== 'users');
  });
});

/* -------------------------- Usuarios (solo admin) -------------------------- */

async function loadUsers() {
  const rows = await api('GET', '/api/users');
  document.getElementById('usersBody').innerHTML = rows.length ? rows.map(u => `
    <tr>
      <td class="mono">${escapeHtml(u.username)}</td>
      <td>${ROLE_LABELS[u.role] || u.role}</td>
      <td>${escapeHtml(u.technician_name || '—')}</td>
      <td>${u.active ? '<span class="badge badge-activo">Activa</span>' : '<span class="badge">Inactiva</span>'}</td>
      <td class="row-actions">
        <button class="btn btn-secondary btn-sm" data-action="edit-user" data-id="${u.id}">Editar</button>
        <button class="btn btn-danger btn-sm" data-action="delete-user" data-id="${u.id}">Eliminar</button>
      </td>
    </tr>`).join('') : `<tr class="empty-row"><td colspan="5">Sin cuentas registradas.</td></tr>`;
}

document.getElementById('btnNewUser').addEventListener('click', async () => {
  await refreshTechniciansCache();
  openUserForm(null);
});

document.getElementById('usersBody').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'edit-user') {
    await refreshTechniciansCache();
    const rows = await api('GET', '/api/users');
    openUserForm(rows.find(r => String(r.id) === String(btn.dataset.id)));
  } else if (btn.dataset.action === 'delete-user') {
    if (!confirm('¿Eliminar esta cuenta de acceso?')) return;
    try {
      await api('DELETE', `/api/users/${btn.dataset.id}`);
      toast('Cuenta eliminada');
      await loadUsers();
    } catch (err) { toast(err.message, true); }
  }
});

function openUserForm(user) {
  const isEdit = !!user;
  openModal(isEdit ? 'Editar cuenta' : 'Nueva cuenta de acceso', `
    <form id="userForm">
      <div class="field-row">
        <div class="field"><label>Usuario</label><input name="username" required ${isEdit ? 'disabled' : ''} value="${escapeHtml(user?.username || '')}"></div>
        <div class="field">
          <label>Rol</label>
          <select name="role" id="userRoleSelect">
            <option value="admin" ${user?.role === 'admin' ? 'selected' : ''}>Administrador</option>
            <option value="ingeniero" ${user?.role === 'ingeniero' ? 'selected' : ''}>Ingeniero</option>
            <option value="tecnico" ${!user || user?.role === 'tecnico' ? 'selected' : ''}>Técnico</option>
          </select>
        </div>
      </div>
      <div class="field" id="userTechFieldWrap">
        <label>Técnico ligado (para rol Técnico)</label>
        <select name="technician_id">
          <option value="">— Sin ligar —</option>
          ${technicianOptionsHtml(user?.technician_id)}
        </select>
      </div>
      ${!isEdit ? `<div class="field" id="userTechNameWrap"><label>...o crea un técnico nuevo con este nombre</label><input name="technician_name" placeholder="Nombre completo (opcional si ya elegiste uno arriba)"></div>` : ''}
      <div class="field"><label>${isEdit ? 'Nueva contraseña (déjalo vacío para no cambiarla)' : 'Contraseña'}</label><input name="password" type="password" ${isEdit ? '' : 'required'} minlength="6" placeholder="Mínimo 6 caracteres"></div>
      ${isEdit ? `<div class="field"><label><input type="checkbox" name="active" value="1" style="width:auto;display:inline-block;margin-right:6px;" ${user.active ? 'checked' : ''}> Cuenta activa</label></div>` : ''}
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" id="userCancel">Cancelar</button>
        <button type="submit" class="btn btn-primary">${isEdit ? 'Guardar cambios' : 'Crear cuenta'}</button>
      </div>
    </form>
  `);
  document.getElementById('userCancel').addEventListener('click', closeModal);
  document.getElementById('userForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const payload = Object.fromEntries(new FormData(form).entries());
    if (!payload.password) delete payload.password;
    if (isEdit) payload.active = form.elements.active && form.elements.active.checked ? 1 : 0;
    try {
      if (isEdit) await api('PUT', `/api/users/${user.id}`, payload);
      else await api('POST', '/api/users', payload);
      toast(isEdit ? 'Cuenta actualizada' : 'Cuenta creada');
      closeModal();
      await loadUsers();
    } catch (err) { toast(err.message, true); }
  });
}

async function loadTechnicians() {
  const rows = await api('GET', '/api/technicians');
  document.getElementById('techniciansBody').innerHTML = rows.length ? rows.map(t => `
    <tr>
      <td>${escapeHtml(t.name)}</td>
      <td>${escapeHtml(t.area || '—')}</td>
      <td>${t.active ? '<span class="badge badge-activo">Activo</span>' : '<span class="badge">Inactivo</span>'}</td>
      <td class="row-actions">${isAdmin() ? `
        <button class="btn btn-secondary btn-sm" data-action="edit-tech" data-id="${t.id}">Editar</button>
        <button class="btn btn-danger btn-sm" data-action="delete-tech" data-id="${t.id}">Eliminar</button>` : '<span class="muted">—</span>'}
      </td>
    </tr>`).join('') : `<tr class="empty-row"><td colspan="4">Sin técnicos registrados.</td></tr>`;
}

document.getElementById('btnNewTechnician').addEventListener('click', () => openTechnicianForm(null));
document.getElementById('techniciansBody').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'edit-tech') {
    const rows = await api('GET', '/api/technicians');
    openTechnicianForm(rows.find(r => String(r.id) === String(btn.dataset.id)));
  } else if (btn.dataset.action === 'delete-tech') {
    if (!confirm('¿Eliminar este técnico? Las programaciones que lo tenían asignado quedarán sin técnico.')) return;
    await api('DELETE', `/api/technicians/${btn.dataset.id}`);
    toast('Técnico eliminado');
    await loadTechnicians();
  }
});

function openTechnicianForm(tech) {
  const isEdit = !!tech;
  openModal(isEdit ? 'Editar técnico' : 'Nuevo técnico de manufactura', `
    <form id="techForm">
      <div class="field"><label>Nombre</label><input name="name" required value="${escapeHtml(tech?.name || '')}"></div>
      <div class="field"><label>Área</label><input name="area" placeholder="Manufactura, Mantenimiento..." value="${escapeHtml(tech?.area || '')}"></div>
      ${isEdit ? `<div class="field"><label><input type="checkbox" name="active" value="1" style="width:auto;display:inline-block;margin-right:6px;" ${tech.active ? 'checked' : ''}> Técnico activo</label></div>` : ''}
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" id="techCancel">Cancelar</button>
        <button type="submit" class="btn btn-primary">${isEdit ? 'Guardar cambios' : 'Crear'}</button>
      </div>
    </form>
  `);
  document.getElementById('techCancel').addEventListener('click', closeModal);
  document.getElementById('techForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const payload = Object.fromEntries(new FormData(form).entries());
    if (isEdit) payload.active = form.elements.active && form.elements.active.checked ? 1 : 0;
    try {
      if (isEdit) await api('PUT', `/api/technicians/${tech.id}`, payload);
      else await api('POST', '/api/technicians', payload);
      toast(isEdit ? 'Técnico actualizado' : 'Técnico creado');
      closeModal();
      await loadTechnicians();
    } catch (err) { toast(err.message, true); }
  });
}

async function loadLines() {
  const [lines, tools] = await Promise.all([api('GET', '/api/lines'), api('GET', '/api/tools')]);
  document.getElementById('linesBody').innerHTML = lines.length ? lines.map(l => {
    const count = tools.filter(t => String(t.assembly_line_id) === String(l.id)).length;
    return `
    <tr>
      <td>${escapeHtml(l.name)}</td>
      <td>${count}</td>
      <td class="row-actions">${isAdmin() ? `
        <button class="btn btn-secondary btn-sm" data-action="edit-line" data-id="${l.id}">Editar</button>
        <button class="btn btn-danger btn-sm" data-action="delete-line" data-id="${l.id}">Eliminar</button>` : '<span class="muted">—</span>'}
      </td>
    </tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="3">Sin líneas de ensamble registradas.</td></tr>`;
}

document.getElementById('btnNewLine').addEventListener('click', () => openLineForm(null));
document.getElementById('linesBody').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'edit-line') {
    const rows = await api('GET', '/api/lines');
    openLineForm(rows.find(r => String(r.id) === String(btn.dataset.id)));
  } else if (btn.dataset.action === 'delete-line') {
    if (!confirm('¿Eliminar esta línea? Las herramientas asignadas quedarán sin línea.')) return;
    await api('DELETE', `/api/lines/${btn.dataset.id}`);
    toast('Línea eliminada');
    await loadLines();
  }
});

function openLineForm(line) {
  const isEdit = !!line;
  openModal(isEdit ? 'Editar línea de ensamble' : 'Nueva línea de ensamble', `
    <form id="lineForm">
      <div class="field"><label>Nombre</label><input name="name" required value="${escapeHtml(line?.name || '')}" placeholder="Ej. Línea 1, Ensamble Final..."></div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" id="lineCancel">Cancelar</button>
        <button type="submit" class="btn btn-primary">${isEdit ? 'Guardar cambios' : 'Crear'}</button>
      </div>
    </form>
  `);
  document.getElementById('lineCancel').addEventListener('click', closeModal);
  document.getElementById('lineForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(e.target).entries());
    try {
      if (isEdit) await api('PUT', `/api/lines/${line.id}`, payload);
      else await api('POST', '/api/lines', payload);
      toast(isEdit ? 'Línea actualizada' : 'Línea creada');
      closeModal();
      await loadLines();
    } catch (err) { toast(err.message, true); }
  });
}

/* ======================== Utils ======================== */

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* ======================== Init ======================== */

let appStarted = false;
function startApp() {
  if (appStarted) return; // ya se había arrancado (p.ej. volviste a iniciar sesión sin recargar)
  appStarted = true;
  goToTab('dashboard');
  refreshNotifBadge().catch(() => {});
  setInterval(() => refreshNotifBadge().catch(() => {}), 45000);
}

checkSession();
