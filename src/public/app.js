// ============================================
// KRONOS — app.js v4
// Subtarefas · Barra de progresso · Concluídas
// ============================================

const lists = { Tarefa: 'Tarefas', Backlog: 'Backlog', Ideia: 'Ideias', Concluida: 'Concluídas' };

const state = {
  list:      'Tarefa',
  company:   '',
  impact:    '',
  search:    '',
  tasks:     [],
  allTasks:  [],
  stats:     null,
  today:      null,
  todayCollapsed: localStorage.getItem('Kronos_TODAY_COLLAPSED') === 'true',
  activeView: 'execution',
  backupsLoaded: false,
  backups:   [],
  calendarStatus: null,
  calendarEvents: { today: [], tomorrow: [] },
  subtasks:  {}, // taskId → []
  completedPage: 1,
  completedHasMore: false,
  viewMode: localStorage.getItem('KRONOS_VIEW_MODE') || 'list',
};

const board = document.querySelector('#taskBoard');
const modal = document.querySelector('#taskModal');
const form  = document.querySelector('#taskForm');
const appView = document.querySelector('#appView');
const loginView = document.querySelector('#loginView');
const loginForm = document.querySelector('#loginForm');
const loginError = document.querySelector('#loginError');

const fields = {
  id:      document.querySelector('#taskId'),
  title:   document.querySelector('#titleInput'),
  company: document.querySelector('#companyInput'),
  impact:  document.querySelector('#impactInput'),
  list:    document.querySelector('#listInput'),
  status:  document.querySelector('#statusInput'),
  dueDate: document.querySelector('#dueDateInput'),
  syncCalendar: document.querySelector('#syncCalendarInput'),
  calendarStartTime: document.querySelector('#calendarStartTimeInput'),
  calendarDuration: document.querySelector('#calendarDurationInput'),
  notes:   document.querySelector('#notesInput'),
};

let activeDragTaskId = null;

// ============================================
// UTILS
// ============================================

function qs(params) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) q.set(k, v); });
  return q.toString();
}

async function api(path, options = {}) {
  const { headers = {}, ...fetchOptions } = options;
  const res = await fetch(path, {
    ...fetchOptions,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
  if (res.status === 401) {
    showLogin();
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Erro na API');
  }
  if (res.status === 204) return null;
  return res.json();
}

async function downloadCsv() {
  const res = await fetch('/api/tasks/export?format=csv');
  if (res.status === 401) {
    showLogin();
    throw new Error('Unauthorized');
  }
  if (!res.ok) throw new Error('Erro ao exportar CSV');

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'kronos_tasks.csv';
  link.click();
  URL.revokeObjectURL(url);
}

function showLogin(message = '') {
  appView.hidden = true;
  loginView.hidden = false;
  loginError.hidden = !message;
  loginError.textContent = message;
  document.querySelector('#loginPassword').value = '';
  document.querySelector('#loginUsername').focus();
}

function showApp() {
  loginView.hidden = true;
  appView.hidden = false;
  loginError.hidden = true;
  loginError.textContent = '';
  switchView(state.activeView);
}

async function checkAuth() {
  const res = await fetch('/api/auth/me');
  if (!res.ok) return false;
  const body = await res.json().catch(() => ({}));
  return Boolean(body.authenticated);
}

async function submitLogin(event) {
  event.preventDefault();
  loginError.hidden = true;
  loginError.textContent = '';

  const username = document.querySelector('#loginUsername').value.trim();
  const password = document.querySelector('#loginPassword').value;

  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    showLogin('Usuário ou senha inválidos.');
    return;
  }

  showApp();
  await loadTasks();
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  showLogin();
}

async function init() {
  updateToggleButtons();
  if (await checkAuth()) {
    showApp();
    await loadTasks();
    return;
  }

  showLogin();
}

async function switchView(view) {
  state.activeView = view;
  document.querySelector('#executionView').hidden = view !== 'execution';
  document.querySelector('#settingsView').hidden = view !== 'settings';
  document.querySelector('#addTaskBtn').hidden = view !== 'execution' || state.list === 'Concluida';

  document.querySelectorAll('.app-nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  if (view === 'settings' && !state.backupsLoaded) {
    await loadBackups();
  }

  if (view === 'settings') {
    await loadCalendarStatus();
  }
}

function escapeHtml(v) {
  return String(v)
    .replaceAll('&','&amp;').replaceAll('<','&lt;')
    .replaceAll('>','&gt;').replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');
}

function parseDate(s) {
  if (!s) return null;
  return new Date(String(s).includes('T') ? s : `${s}Z`);
}

function daysSince(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return 0;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function formatAge(days) {
  if (days < 1)   return 'hoje';
  if (days === 1) return '1 dia';
  if (days < 30)  return `${days} dias`;
  const m = Math.floor(days / 30);
  return m === 1 ? '1 mês' : `${m} meses`;
}

function ageClass(days) {
  if (days < 3)  return 'fresh';
  if (days <= 7) return 'warn';
  return 'old';
}

function formatElapsed(task) {
  if (task.status !== 'Em andamento' || !task.started_at) return '';
  const started = parseDate(task.started_at);
  if (!started) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - started.getTime()) / 60000));
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${m > 0 ? ` ${m}m` : ''}`;
}

function formatDuration(minutes) {
  if (minutes === null || minutes === undefined) return '-';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}min`;
}

function formatDate(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return '';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTime(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return '';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatEventTimeRange(event) {
  if (event.all_day) return { time: 'Dia inteiro', duration: '' };

  const start = parseDate(event.start);
  const end = parseDate(event.end);
  if (!start) return { time: '', duration: '' };

  const startText = start.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (!end || end <= start) return { time: startText, duration: '' };

  const endText = end.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
  const duration = minutes < 60
    ? `${minutes}min`
    : `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}min` : ''}`;

  return { time: `${startText}-${endText}`, duration };
}

function cleanCalendarTitle(title) {
  return String(title || 'Sem título').replace(/^\[(Olympus|IbogaLiv|PlugAI|Pessoal)\]\s*/i, '');
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function companyLabel(company) {
  return company || 'Sem empresa';
}

function companyClass(company) {
  return company || 'SemEmpresa';
}

function dueDateClass(dueDate) {
  if (!dueDate) return '';
  const today = new Date();
  const current = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const due = new Date(`${dueDate}T00:00:00`);
  const diff = Math.round((due.getTime() - current.getTime()) / 86400000);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  return '';
}

function dueDateText(dueDate) {
  const cls = dueDateClass(dueDate);
  const label = cls === 'overdue' ? 'Vencido' : cls === 'today' ? 'Hoje' : 'Prazo';
  return `${label}: ${formatDate(dueDate)}`;
}

function taskCompanyBadge(task) {
  return `<span class="badge ${companyClass(task.company)}">${companyLabel(task.company)}</span>`;
}

function taskImpactChip(task) {
  return `<span class="chip ${impactChipClass(task.impact)}">${task.impact}</span>`;
}

function impactChipClass(impact) {
  if (impact === 'Alto')  return 'chip-impact-alto';
  if (impact === 'Médio') return 'chip-impact-medio';
  return 'chip-impact-baixo';
}

function sortByPriority(tasks) {
  const order = { Alto: 0, 'Médio': 1, Baixo: 2 };
  return [...tasks].sort((a, b) => {
    if (a.due_date || b.due_date) {
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      const dueDiff = new Date(a.due_date) - new Date(b.due_date);
      if (dueDiff !== 0) return dueDiff;
    }
    const diff = (order[a.impact] ?? 3) - (order[b.impact] ?? 3);
    if (diff !== 0) return diff;
    return new Date(a.created_at) - new Date(b.created_at);
  });
}

// ============================================
// MÉTRICAS
// ============================================

async function loadAllTasks() {
  const result = await api('/api/tasks');
  state.allTasks = result.data || [];
}

async function loadStats() {
  const stats = await api('/api/tasks/stats');
  state.stats = stats;
  document.querySelector('#statusSummary').textContent =
    `Em andamento (${stats.by_status['Em andamento'] || 0}) · A fazer (${stats.by_status['A fazer'] || 0}) · Pausada (${stats.by_status.Pausada || 0})`;
  document.querySelector('#tabBadgeConcluida').textContent = stats.by_status['Concluída'] || 0;

  const colors = { IbogaLiv: '#16A34A', Olympus: '#B8960C', PlugAI: '#6366F1', Pessoal: '#64748B', 'Sem empresa': '#94A3B8' };
  document.querySelector('#distBar').innerHTML = Object.entries(stats.by_company)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([company, count]) => `
      <div class="dist-item">
        <span class="dist-dot" style="background:${colors[company] || '#888'}"></span>
        <span>${company}</span>
        <span class="dist-num">${count}</span>
      </div>
    `).join('');
}

function setTodayCollapsed(collapsed) {
  state.todayCollapsed = collapsed;
  localStorage.setItem('Kronos_TODAY_COLLAPSED', collapsed ? 'true' : 'false');
  document.querySelector('#todayPanel').classList.toggle('collapsed', collapsed);
  document.querySelector('#todayToggleBtn').textContent = collapsed ? 'Expandir' : 'Recolher';
}

function renderTodayItem(task) {
  const due = task.due_date ? `<span class="today-due ${dueDateClass(task.due_date)}">${dueDateText(task.due_date)}</span>` : '';
  return `
    <article class="today-task">
      <h3>${escapeHtml(task.title)}</h3>
      <div class="today-meta">
        ${taskCompanyBadge(task)}
        ${taskImpactChip(task)}
        <span class="chip">${task.status}</span>
        ${due}
      </div>
      <button class="btn-edit" type="button" data-open-id="${task.id}">Abrir</button>
    </article>
  `;
}

function renderTodaySection(title, tasks, extraClass = '') {
  return `
    <section class="today-section ${extraClass}">
      <h3>${title}</h3>
      <div class="today-section-list">
        ${tasks.length ? tasks.map(renderTodayItem).join('') : '<p class="today-empty">Nada aqui.</p>'}
      </div>
    </section>
  `;
}

function renderCalendarEvent(event) {
  const company = event.company || null;
  const companyBadge = company ? `<span class="badge ${companyClass(company)}">${company}</span>` : '';
  const location = event.location ? `<span class="calendar-location">${escapeHtml(event.location)}</span>` : '';
  const { time, duration } = formatEventTimeRange(event);
  const durationHtml = duration ? `<span class="calendar-duration">${duration}</span>` : '';
  return `
    <article class="today-task calendar-event ${companyClass(company)}">
      <div class="calendar-event-header">
        <span class="calendar-time">${time}</span>
        ${durationHtml}
      </div>
      <h3 class="calendar-event-title">${escapeHtml(cleanCalendarTitle(event.title))}</h3>
      <div class="today-meta">
        ${companyBadge}
        <span class="calendar-source">Agenda</span>
        ${location}
      </div>
    </article>
  `;
}

function renderCalendarSection(title, events) {
  const connected = state.calendarStatus?.connected || events.length > 0;
  const emptyText = !connected
    ? 'Agenda não conectada.'
    : title === 'Agenda hoje'
      ? 'Nenhum compromisso hoje.'
      : 'Nenhum compromisso amanhã.';
  return `
    <section class="today-section today-calendar">
      <h3>${title}</h3>
      <div class="today-section-list">
        ${events.length ? events.map(renderCalendarEvent).join('') : `<p class="today-empty">${emptyText}</p>`}
      </div>
    </section>
  `;
}

function renderToday() {
  if (!state.today) return;
  const summary = state.today.summary;
  const calendarTodayCount = state.calendarEvents.today.length;
  const calendarTomorrowCount = state.calendarEvents.tomorrow.length;
  document.querySelector('#todaySummary').textContent =
    `Atrasadas (${summary.overdue}) · Hoje (${summary.today}) · Amanhã (${summary.tomorrow}) · Em andamento (${summary.in_progress}) · Alta prioridade (${summary.high_priority}) · Agenda hoje (${calendarTodayCount}) · Agenda amanhã (${calendarTomorrowCount})`;

  document.querySelector('#todayGrid').innerHTML = [
    renderTodaySection('Atrasadas', state.today.overdue, 'today-overdue'),
    renderTodaySection('Para hoje', state.today.today),
    renderTodaySection('Amanhã', state.today.tomorrow),
    renderTodaySection('Em andamento', state.today.in_progress),
    renderTodaySection('Alta prioridade', state.today.high_priority),
    renderCalendarSection('Agenda hoje', state.calendarEvents.today),
    renderCalendarSection('Agenda amanhã', state.calendarEvents.tomorrow),
  ].join('');

  setTodayCollapsed(state.todayCollapsed);
}

async function loadToday() {
  state.today = await api('/api/tasks/today');
  await loadCalendarEvents();
  renderToday();
}

function renderCalendarStatus() {
  const title = document.querySelector('#calendarStatusTitle');
  const text = document.querySelector('#calendarStatusText');
  const connectButton = document.querySelector('#connectCalendarBtn');
  const disconnectButton = document.querySelector('#disconnectCalendarBtn');
  if (!title || !text || !connectButton || !disconnectButton) return;

  const status = state.calendarStatus;
  if (status?.connected) {
    title.textContent = 'Google Agenda conectada';
    text.textContent = `Calendar ID: ${status.calendar_id || 'primary'} · Lê eventos e cria/atualiza tarefas marcadas para sincronizar. Use desconectar para trocar permissões ou reconectar a conta Google.`;
    connectButton.hidden = true;
    disconnectButton.hidden = false;
    return;
  }

  title.textContent = 'Agenda não conectada';
  text.textContent = 'Google Agenda não conectada. Conecte para ler eventos e sincronizar tarefas selecionadas.';
  connectButton.hidden = false;
  disconnectButton.hidden = true;
}

async function loadCalendarStatus() {
  try {
    state.calendarStatus = await api('/api/calendar/status');
  } catch (err) {
    state.calendarStatus = { connected: false, calendar_id: 'primary' };
  }
  renderCalendarStatus();
}

async function connectGoogleCalendar() {
  const result = await api('/api/calendar/oauth/start');
  if (result.url) window.location.href = result.url;
}

async function disconnectGoogleCalendar() {
  if (!confirm('Desconectar a Google Agenda deste Kronos?')) return;
  await api('/api/calendar/disconnect', { method: 'POST' });
  state.calendarStatus = { connected: false, calendar_id: state.calendarStatus?.calendar_id || 'primary' };
  state.calendarEvents = { today: [], tomorrow: [] };
  renderCalendarStatus();
  renderToday();
  updateCalendarSyncFields();
}

async function loadCalendarEvents() {
  try {
    const [today, tomorrow] = await Promise.all([
      api('/api/calendar/events?range=today'),
      api('/api/calendar/events?range=tomorrow'),
    ]);

    state.calendarStatus = {
      connected: Boolean(today.connected || tomorrow.connected),
      calendar_id: state.calendarStatus?.calendar_id || 'primary',
    };
    state.calendarEvents = {
      today: today.data || [],
      tomorrow: tomorrow.data || [],
    };
  } catch (err) {
    state.calendarEvents = { today: [], tomorrow: [] };
  }
}

function updateCalendarSyncFields() {
  const syncChecked = fields.syncCalendar.checked;
  const connected = Boolean(state.calendarStatus?.connected);
  const hasDueDate = Boolean(fields.dueDate.value);
  const note = document.querySelector('#calendarSyncNote');
  const controls = document.querySelector('#calendarSyncFields');

  controls.classList.toggle('disabled', !syncChecked);
  fields.calendarStartTime.disabled = !syncChecked;
  fields.calendarDuration.disabled = !syncChecked;

  if (!connected) {
    note.textContent = 'Conecte a Google Agenda em Configurações para sincronizar esta tarefa.';
    note.className = 'calendar-sync-note warn';
    return;
  }

  if (syncChecked && !hasDueDate) {
    note.textContent = 'Defina um prazo para salvar na agenda.';
    note.className = 'calendar-sync-note warn';
    return;
  }

  if (syncChecked) {
    note.textContent = 'A tarefa será criada ou atualizada na Google Agenda ao salvar.';
    note.className = 'calendar-sync-note success';
    return;
  }

  note.textContent = 'Marque para criar ou atualizar um evento desta tarefa na Google Agenda.';
  note.className = 'calendar-sync-note';
}

function setBackupMessage(message, type = '') {
  const el = document.querySelector('#backupMessage');
  el.textContent = message;
  el.className = `backup-message ${type}`.trim();
}

function renderBackups() {
  const list = document.querySelector('#backupList');
  if (!state.backups.length) {
    list.innerHTML = '<p class="backup-message">Nenhum backup encontrado.</p>';
    return;
  }

  list.innerHTML = state.backups.map((backup) => `
    <div class="backup-item">
      <span class="backup-file">${escapeHtml(backup.filename)}</span>
      <span class="backup-meta">${formatBytes(backup.size_bytes)}${backup.created_at ? ` · ${formatDateTime(backup.created_at)}` : ''}</span>
      <a class="backup-download" href="/api/backups/${encodeURIComponent(backup.filename)}/download" target="_blank" rel="noopener">Baixar</a>
    </div>
  `).join('');
}

async function loadBackups() {
  const result = await api('/api/backups');
  state.backups = result.data || [];
  state.backupsLoaded = true;
  renderBackups();
  setBackupMessage(`${state.backups.length} backup(s) disponível(is).`);
}

async function runManualBackup() {
  const button = document.querySelector('#runBackupBtn');
  button.disabled = true;
  setBackupMessage('Gerando backup agora...');

  try {
    const result = await api('/api/backups/run', { method: 'POST' });
    await loadBackups();
    setBackupMessage(`Backup criado: ${result.backup.filename}`, 'success');
  } catch (err) {
    setBackupMessage('Não foi possível gerar o backup.', 'error');
    throw err;
  } finally {
    button.disabled = false;
  }
}

function updateMetrics() {
  const all = state.allTasks;

  const counts = { Tarefa: 0, Backlog: 0, Ideia: 0, Concluida: 0 };

  all.forEach(t => { if (counts[t.list_type] !== undefined) counts[t.list_type]++; });

  document.querySelector('#countTarefa').textContent  = counts.Tarefa;
  document.querySelector('#countBacklog').textContent = counts.Backlog;
  document.querySelector('#countIdeia').textContent   = counts.Ideia;

  document.querySelector('#tabBadgeTarefa').textContent  = counts.Tarefa;
  document.querySelector('#tabBadgeBacklog').textContent = counts.Backlog;
  document.querySelector('#tabBadgeIdeia').textContent   = counts.Ideia;

  const emAndamento = all.filter(t => t.list_type === 'Tarefa' && t.status === 'Em andamento').length;
  const pausadas    = all.filter(t => t.list_type === 'Tarefa' && t.status === 'Pausada').length;
  const urgentes    = all.filter(t => t.list_type === 'Tarefa' && daysSince(t.created_at) > 7).length;

  document.querySelector('#subTarefa').textContent = emAndamento > 0
    ? `${emAndamento} em andamento`
    : 'nenhuma em andamento';

  // Progresso
  const tarefasAll = all.filter(t => t.list_type === 'Tarefa');
  const pct = tarefasAll.length > 0
    ? Math.round((tarefasAll.filter(t => t.status === 'Concluída').length / tarefasAll.length) * 100)
    : 0;

  const done = state.stats?.by_status?.['Concluída'] || 0;
  const total = tarefasAll.length + done;
  const realPct = total > 0 ? Math.round((done / total) * 100) : pct;
  const offset = 163.4 - (realPct / 100) * 163.4;
  document.querySelector('#progressRing').style.strokeDashoffset = offset;
  document.querySelector('#progressPct').textContent = `${realPct}%`;
  document.querySelector('#progressSub').textContent = `${done}/${total} tarefas`;

  // Métricas extras no card de progresso
  document.querySelector('#metricExtra').innerHTML = `
    <div class="metric-extra-row">
      <span>Em andamento</span>
      <strong>${emAndamento}</strong>
    </div>
    <div class="metric-extra-row ${pausadas > 0 ? 'warn' : ''}">
      <span>Pausadas</span>
      <strong>${pausadas}</strong>
    </div>
    <div class="metric-extra-row ${urgentes > 0 ? 'danger' : ''}">
      <span>Urgentes (&gt;7d)</span>
      <strong>${urgentes}</strong>
    </div>
  `;

  document.querySelectorAll('.metric-card[data-list]').forEach(card => {
    card.classList.toggle('active', card.dataset.list === state.list);
  });
}

// ============================================
// RENDER
// ============================================

function renderTaskCard(task, index, isConcluida) {
  const days    = daysSince(task.created_at);
  const cls     = ageClass(days);
  const age     = formatAge(days);
  const elapsed = formatElapsed(task);
  const impactCls = impactChipClass(task.impact);
  const num     = index + 1;
  const ageTitle = days < 1 ? 'Criada hoje' : `No sistema há ${age}`;
  const company = companyLabel(task.company);
  const badgeClass = companyClass(task.company);
  const dueHtml = task.due_date ? `<span class="due-date ${dueDateClass(task.due_date)}">${dueDateText(task.due_date)}</span>` : '';

  // Barra de progresso de subtarefas
  const total = task.subtasks_total || 0;
  const done  = task.subtasks_done  || 0;
  const subPct = total > 0 ? Math.round((done / total) * 100) : 0;
  const isComplete = total > 0 && done === total;

  const progressHtml = total > 0 ? `
    <div class="task-progress">
      <div class="task-progress-header">
        <span>Subtarefas</span>
        <span>${done}/${total}</span>
      </div>
      <div class="task-progress-bar">
        <div class="task-progress-fill ${isComplete ? 'complete' : ''}" style="width:${subPct}%"></div>
      </div>
    </div>
  ` : '';

  if (isConcluida) {
    const completedStr = task.completed_at ? formatDate(task.completed_at) : '';
    return `
      <article class="task task-concluida" data-impact="${task.impact}">
        <span class="priority-num">${num}</span>
        <div class="task-meta">
          <span class="badge ${badgeClass}">${company}</span>
          <span class="chip ${impactCls}">${task.impact}</span>
        </div>
        <h3>${escapeHtml(task.title)}</h3>
        ${dueHtml}
        ${progressHtml}
        <div class="task-footer">
          ${completedStr ? `<span class="completed-date">✓ Concluída em ${completedStr}</span>` : '<span class="completed-date">✓ Concluída</span>'}
          ${task.duration_min ? `<span class="elapsed">⏱ ${formatDuration(task.duration_min)}</span>` : ''}
          <button class="btn-edit" type="button" data-open-id="${task.id}" style="margin-left:auto">Ver</button>
        </div>
      </article>
    `;
  }

  return `
    <article class="task" data-impact="${task.impact}">
      <span class="priority-num">${num}</span>
      <div class="task-meta">
        <span class="badge ${badgeClass}">${company}</span>
        <span class="chip ${impactCls}">${task.impact}</span>
        <span class="chip">${task.status}</span>
        <span class="task-age ${cls}" title="${ageTitle}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          ${age}
        </span>
      </div>
      <h3>${escapeHtml(task.title)}</h3>
      ${dueHtml}
      ${progressHtml}
      <div class="task-footer">
        <select aria-label="Status" data-status-id="${task.id}">
          ${['A fazer','Em andamento','Concluída','Pausada']
            .map(s => `<option ${s === task.status ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        <button class="btn-edit" type="button" data-open-id="${task.id}">Editar</button>
        ${elapsed ? `<span class="elapsed">⏱ ${elapsed}</span>` : ''}
      </div>
    </article>
  `;
}

function renderList() {
  board.innerHTML = '';
  board.classList.remove('kanban-mode');
  const isConcluida = state.list === 'Concluida';

  if (!state.tasks.length) {
    board.innerHTML = `<p class="empty">Nenhum item em ${lists[state.list]}.</p>`;
    return;
  }

  const sorted = isConcluida
    ? [...state.tasks].sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))
    : sortByPriority(state.tasks);

  board.innerHTML = sorted.map((task, i) => renderTaskCard(task, i, isConcluida)).join('');
}

function sortKanbanTasks(tasks) {
  const impactOrder = { Alto: 0, 'Médio': 1, Baixo: 2 };
  return [...tasks].sort((a, b) => {
    const hasA = a.due_date ? 1 : 0;
    const hasB = b.due_date ? 1 : 0;
    if (hasA !== hasB) return hasB - hasA;
    if (a.due_date && b.due_date) {
      const dueDiff = a.due_date.localeCompare(b.due_date);
      if (dueDiff !== 0) return dueDiff;
    }
    const diff = (impactOrder[a.impact] ?? 3) - (impactOrder[b.impact] ?? 3);
    if (diff !== 0) return diff;
    return new Date(a.created_at) - new Date(b.created_at);
  });
}

function renderKanbanCard(task, index) {
  const days    = daysSince(task.created_at);
  const cls     = ageClass(days);
  const age     = formatAge(days);
  const elapsed = formatElapsed(task);
  const impactCls = impactChipClass(task.impact);
  const ageTitle = days < 1 ? 'Criada hoje' : `No sistema há ${age}`;
  const company = companyLabel(task.company);
  const badgeClass = companyClass(task.company);
  const dueHtml = task.due_date ? `<span class="due-date ${dueDateClass(task.due_date)}">${dueDateText(task.due_date)}</span>` : '';

  const total = task.subtasks_total || 0;
  const done  = task.subtasks_done  || 0;
  const subPct = total > 0 ? Math.round((done / total) * 100) : 0;
  const isComplete = total > 0 && done === total;

  const progressHtml = total > 0 ? `
    <div class="task-progress">
      <div class="task-progress-header">
        <span>Subtarefas</span>
        <span>${done}/${total}</span>
      </div>
      <div class="task-progress-bar">
        <div class="task-progress-fill ${isComplete ? 'complete' : ''}" style="width:${subPct}%"></div>
      </div>
    </div>
  ` : '';

  return `
    <article class="task kanban-card" data-impact="${task.impact}" draggable="true" data-task-id="${task.id}">
      <span class="kanban-drag-handle" aria-hidden="true" title="Arrastar">⋮⋮</span>
      <span class="priority-num">${index + 1}</span>
      <div class="task-meta">
        <span class="badge ${badgeClass}">${company}</span>
        <span class="chip ${impactCls}">${task.impact}</span>
        <span class="task-age ${cls}" title="${ageTitle}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          ${age}
        </span>
      </div>
      <h3>${escapeHtml(task.title)}</h3>
      ${dueHtml}
      ${progressHtml}
      <div class="task-footer">
        <select aria-label="Status" data-status-id="${task.id}" draggable="false">
          ${['A fazer','Em andamento','Concluída','Pausada']
            .map(s => `<option ${s === task.status ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        <button class="btn-edit" type="button" data-open-id="${task.id}" draggable="false">Abrir</button>
        ${elapsed ? `<span class="elapsed">⏱ ${elapsed}</span>` : ''}
      </div>
    </article>
  `;
}

function renderKanban() {
  board.innerHTML = '';
  board.classList.add('kanban-mode');

  const columns = ['A fazer', 'Em andamento', 'Pausada', 'Concluída'];
  const grouped = {
    'A fazer': [],
    'Em andamento': [],
    'Pausada': [],
    'Concluída': []
  };

  state.tasks.forEach(task => {
    if (grouped[task.status] !== undefined) {
      grouped[task.status].push(task);
    }
  });

  const columnsHtml = columns.map(status => {
    const tasksInCol = sortKanbanTasks(grouped[status]);
    const count = tasksInCol.length;

    const cardsHtml = tasksInCol.map((task, i) => renderKanbanCard(task, i)).join('');

    return `
      <div class="kanban-column" data-status="${status}">
        <div class="kanban-column-header">
          <h3>${status}</h3>
          <span class="kanban-count">${count}</span>
        </div>
        <div class="kanban-list" data-status="${status}">
          ${cardsHtml || '<p class="empty" style="padding: 24px 0;">Nenhuma tarefa</p>'}
        </div>
      </div>
    `;
  }).join('');

  board.innerHTML = `<div class="kanban-board">${columnsHtml}</div>`;

  setupDragAndDrop();
}

function setupDragAndDrop() {
  if (board.dataset.dragReady === 'true') return;
  board.dataset.dragReady = 'true';

  board.addEventListener('dragstart', (e) => {
    const card = e.target.closest?.('.kanban-card');
    if (!card) return;

    if (e.target.closest('button, select, input, textarea, a')) {
      e.preventDefault();
      return;
    }

    const taskId = card.dataset.taskId;
    if (!taskId || !e.dataTransfer) {
      e.preventDefault();
      return;
    }

    activeDragTaskId = taskId;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', taskId);
  });

  board.addEventListener('dragend', () => {
    board.querySelectorAll('.kanban-card.dragging').forEach(card => card.classList.remove('dragging'));
    board.querySelectorAll('.kanban-list.drag-over').forEach(list => list.classList.remove('drag-over'));
    activeDragTaskId = null;
  });

  board.addEventListener('dragover', (e) => {
    const list = e.target.closest?.('.kanban-list');
    if (!list) return;

    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    list.classList.add('drag-over');
  });

  board.addEventListener('dragleave', (e) => {
    const list = e.target.closest?.('.kanban-list');
    if (!list) return;
    if (e.relatedTarget instanceof Node && list.contains(e.relatedTarget)) return;
    list.classList.remove('drag-over');
  });

  board.addEventListener('drop', async (e) => {
    const list = e.target.closest?.('.kanban-list');
    if (!list) return;

    e.preventDefault();
    list.classList.remove('drag-over');

    const taskId = e.dataTransfer?.getData('text/plain') || activeDragTaskId;
    const nextStatus = list.dataset.status;
    const currentCard = taskId ? board.querySelector(`.kanban-card[data-task-id="${taskId}"]`) : null;
    const currentStatus = currentCard?.closest('.kanban-list')?.dataset.status;

    if (!taskId || !nextStatus || nextStatus === currentStatus) {
      activeDragTaskId = null;
      return;
    }

    await updateTaskStatusFromKanban(Number(taskId), nextStatus);
  });
}

async function updateTaskStatusFromKanban(taskId, nextStatus) {
  try {
    await api(`/api/tasks/${taskId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: nextStatus }),
    });
    await loadTasks();
  } catch (err) {
    console.error('Erro ao atualizar status do card:', err);
    alert('Não foi possível alterar o status da tarefa. Recarregando dados...');
    await loadTasks();
  }
}

function setViewMode(mode) {
  state.viewMode = mode;
  localStorage.setItem('KRONOS_VIEW_MODE', mode);
  updateToggleButtons();
  render();
}

function updateToggleButtons() {
  const container = document.querySelector('#viewModeToggle');
  if (container) {
    container.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === state.viewMode);
    });
  }
}

function render() {
  const isConcluida = state.list === 'Concluida';
  if (!isConcluida && state.viewMode === 'kanban') {
    renderKanban();
  } else {
    renderList();
  }
}

// ============================================
// LOAD
// ============================================

async function loadTasks() {
  if (state.list === 'Concluida') state.completedPage = 1;

  const params = state.list === 'Concluida'
    ? { list: 'Concluida', page: state.completedPage, limit: 20, search: state.search, company: state.company, impact: state.impact }
    : { list: state.list, company: state.company, impact: state.impact, search: state.search };

  const result = await api(`/api/tasks?${qs(params)}`);
  state.tasks = result.data;
  state.completedHasMore = Boolean(result.pagination?.has_more);
  await loadAllTasks();
  await loadStats();
  await loadToday();
  updateMetrics();

  const isConcluida = state.list === 'Concluida';
  const toggleEl = document.querySelector('#viewModeToggle');
  if (toggleEl) {
    toggleEl.style.display = isConcluida ? 'none' : '';
    if (!isConcluida) {
      updateToggleButtons();
    }
  }

  render();
  document.querySelector('#loadMoreBtn').hidden = !(state.list === 'Concluida' && state.completedHasMore);

  // Oculta legenda e filtros na aba concluídas
  document.querySelector('#urgencyLegend').style.display = isConcluida ? 'none' : '';
  document.querySelector('#addTaskBtn').hidden = state.activeView !== 'execution' || isConcluida;
}

async function loadMoreCompleted() {
  state.completedPage += 1;
  const result = await api(`/api/tasks?${qs({
    list: 'Concluida',
    page: state.completedPage,
    limit: 20,
    search: state.search,
    company: state.company,
    impact: state.impact,
  })}`);
  state.tasks = [...state.tasks, ...(result.data || [])];
  state.completedHasMore = Boolean(result.pagination?.has_more);
  render();
  document.querySelector('#loadMoreBtn').hidden = !state.completedHasMore;
}

// ============================================
// SUBTAREFAS (modal)
// ============================================

let currentSubtasks = [];
let currentTaskId   = null;

function renderSubtaskList() {
  const ul = document.querySelector('#subtaskList');
  const countEl = document.querySelector('#subtasksCount');
  const done = currentSubtasks.filter(s => s.done).length;
  countEl.textContent = currentSubtasks.length > 0
    ? `${done}/${currentSubtasks.length}`
    : '';

  ul.innerHTML = currentSubtasks.map(sub => {
    const dueClass = sub.due_date ? dueDateClass(sub.due_date) : '';
    return `
      <li class="subtask-item ${sub.done ? 'done' : ''} ${dueClass}" data-sub-id="${sub.id}">
        <input type="checkbox" ${sub.done ? 'checked' : ''} data-toggle-sub="${sub.id}" />
        <div class="subtask-main">
          <span>${escapeHtml(sub.title)}</span>
          ${sub.due_date ? `<small class="subtask-due ${dueClass}">${dueDateText(sub.due_date)}</small>` : ''}
        </div>
        <input class="subtask-date-input" type="date" value="${sub.due_date || ''}" data-sub-due-id="${sub.id}" aria-label="Data da subtarefa ${escapeHtml(sub.title)}" />
        <button type="button" data-del-sub="${sub.id}" title="Remover">×</button>
      </li>
    `;
  }).join('');
}

async function loadSubtasks(taskId) {
  const result = await api(`/api/tasks/${taskId}/subtasks`);
  currentSubtasks = result.data || [];
  renderSubtaskList();
}

document.querySelector('#addSubtaskBtn').addEventListener('click', async () => {
  const input = document.querySelector('#newSubtaskInput');
  const dueInput = document.querySelector('#newSubtaskDueDateInput');
  const title = input.value.trim();
  if (!title || !currentTaskId) return;
  const result = await api(`/api/tasks/${currentTaskId}/subtasks`, {
    method: 'POST',
    body: JSON.stringify({ title, due_date: dueInput.value || null }),
  });
  currentSubtasks.push(result.data);
  input.value = '';
  dueInput.value = '';
  renderSubtaskList();
});

document.querySelector('#newSubtaskInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.querySelector('#addSubtaskBtn').click();
  }
});

document.querySelector('#subtaskList').addEventListener('change', async (e) => {
  const toggleId = e.target.dataset.toggleSub;
  const dueId = e.target.dataset.subDueId;

  if (toggleId) {
    const updated = await api(`/api/subtasks/${toggleId}`, {
      method: 'PATCH',
      body: JSON.stringify({ done: e.target.checked }),
    });
    const sub = currentSubtasks.find(s => s.id === Number(toggleId));
    if (sub) Object.assign(sub, updated.data);
  }

  if (dueId) {
    const updated = await api(`/api/subtasks/${dueId}`, {
      method: 'PATCH',
      body: JSON.stringify({ due_date: e.target.value || null }),
    });
    const sub = currentSubtasks.find(s => s.id === Number(dueId));
    if (sub) Object.assign(sub, updated.data);
  }

  renderSubtaskList();
});

document.querySelector('#subtaskList').addEventListener('click', async (e) => {
  const id = e.target.dataset.delSub;
  if (!id) return;
  await api(`/api/subtasks/${id}`, { method: 'DELETE' });
  currentSubtasks = currentSubtasks.filter(s => s.id !== Number(id));
  renderSubtaskList();
});

// ============================================
// MODAL
// ============================================

function resetForm() {
  fields.id.value      = '';
  fields.title.value   = '';
  fields.company.value = '';
  fields.impact.value  = 'Médio';
  fields.list.value    = state.list === 'Concluida' ? 'Tarefa' : state.list;
  fields.status.value  = 'A fazer';
  fields.dueDate.value = '';
  fields.syncCalendar.checked = false;
  fields.calendarStartTime.value = '09:00';
  fields.calendarDuration.value = '60';
  fields.notes.value   = '';
  document.querySelector('#modalTitle').textContent = 'Nova tarefa';
  document.querySelector('#taskDetail').hidden      = true;
  document.querySelector('#deleteBtn').hidden       = true;
  document.querySelector('#subtasksSection').style.display = 'none';
  document.querySelector('#newSubtaskInput').value = '';
  document.querySelector('#newSubtaskDueDateInput').value = '';
  currentSubtasks = [];
  currentTaskId   = null;
  updateCalendarSyncFields();
}

async function openTask(id) {
  const result = await api(`/api/tasks/${id}`);
  const task = result.data;

  fields.id.value      = task.id;
  fields.title.value   = task.title;
  fields.company.value = task.company || '';
  fields.impact.value  = task.impact;
  fields.list.value    = task.list_type;
  fields.status.value  = task.status;
  fields.dueDate.value = task.due_date || '';
  fields.syncCalendar.checked = Boolean(task.sync_to_calendar);
  fields.calendarStartTime.value = task.calendar_start_time || '09:00';
  fields.calendarDuration.value = String(task.calendar_duration_min || 60);
  fields.notes.value   = task.notes || '';

  document.querySelector('#modalTitle').textContent = 'Editar tarefa';
  document.querySelector('#taskDetail').hidden      = false;
  document.querySelector('#deleteBtn').hidden       = false;
  document.querySelector('#totalTime').textContent  = formatDuration(task.duration_min);
  document.querySelector('#subtasksSection').style.display = '';

  document.querySelector('#historyList').innerHTML = task.history.length
    ? task.history.map(item => {
        const d = parseDate(item.changed_at);
        return `<li>${item.from_status || 'Criada'} → ${item.to_status} · ${d ? d.toLocaleString('pt-BR') : item.changed_at}</li>`;
      }).join('')
    : '<li>Sem mudanças registradas.</li>';

  currentTaskId = task.id;
  currentSubtasks = task.subtasks || [];
  renderSubtaskList();
  updateCalendarSyncFields();
  if (task.google_event_id) {
    const note = document.querySelector('#calendarSyncNote');
    note.textContent = 'Sincronizada com Google Agenda.';
    note.className = 'calendar-sync-note success';
  }

  modal.showModal();
}

async function saveTask(event) {
  event.preventDefault();
  const payload = {
    title:     fields.title.value,
    company:   fields.company.value,
    impact:    fields.impact.value,
    list_type: fields.list.value,
    status:    fields.status.value,
    due_date:  fields.dueDate.value || null,
    sync_to_calendar: fields.syncCalendar.checked,
    calendar_start_time: fields.syncCalendar.checked ? fields.calendarStartTime.value || '09:00' : null,
    calendar_duration_min: fields.syncCalendar.checked ? Number(fields.calendarDuration.value || 60) : null,
    notes:     fields.notes.value,
  };

  let taskId = fields.id.value;

  if (taskId) {
    const result = await api(`/api/tasks/${taskId}`, { method: 'PUT', body: JSON.stringify(payload) });
    if (result.calendar_sync_failed) alert('Tarefa salva, mas não foi possível sincronizar com a agenda.');
  } else {
    const result = await api('/api/tasks', { method: 'POST', body: JSON.stringify(payload) });
    if (result.calendar_sync_failed) alert('Tarefa salva, mas não foi possível sincronizar com a agenda.');
    taskId = result.data.id;
    currentTaskId = taskId;

    // Salva subtarefas adicionadas antes do save
    for (const sub of currentSubtasks) {
      if (!sub.id) {
        await api(`/api/tasks/${taskId}/subtasks`, {
          method: 'POST',
          body: JSON.stringify({ title: sub.title, due_date: sub.due_date || null }),
        });
      }
    }
  }

  modal.close();
  await loadTasks();
}

// ============================================
// EVENTOS
// ============================================

document.querySelector('#addTaskBtn').addEventListener('click', () => {
  resetForm();
  document.querySelector('#subtasksSection').style.display = 'none';
  modal.showModal();
});

document.querySelector('#closeModalBtn').addEventListener('click', () => modal.close());
document.querySelector('#cancelBtn').addEventListener('click',    () => modal.close());

document.querySelector('#deleteBtn').addEventListener('click', async () => {
  if (!fields.id.value) return;
  await api(`/api/tasks/${fields.id.value}`, { method: 'DELETE' });
  modal.close();
  await loadTasks();
});

form.addEventListener('submit', saveTask);

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', async () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    state.list = tab.dataset.list;
    await loadTasks();
  });
});

document.querySelectorAll('.metric-card[data-list]').forEach(card => {
  card.addEventListener('click', async () => {
    const list = card.dataset.list;
    state.list = list;
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.toggle('active', t.dataset.list === list);
    });
    await loadTasks();
  });
});

document.querySelector('#companyFilter').addEventListener('change', async (e) => {
  state.company = e.target.value;
  await loadTasks();
});

document.querySelector('#impactFilter').addEventListener('change', async (e) => {
  state.impact = e.target.value;
  await loadTasks();
});

let searchTimer = null;
document.querySelector('#searchInput').addEventListener('input', (e) => {
  state.search = e.target.value.trim();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { loadTasks(); }, 300);
});

document.querySelector('#exportCsvBtn').addEventListener('click', async () => {
  await downloadCsv();
});

document.querySelector('#loadMoreBtn').addEventListener('click', async () => {
  await loadMoreCompleted();
});

document.querySelector('#refreshBackupsBtn').addEventListener('click', async () => {
  await loadBackups();
});

document.querySelector('#runBackupBtn').addEventListener('click', async () => {
  await runManualBackup();
});

document.querySelector('#refreshCalendarBtn').addEventListener('click', async () => {
  await loadCalendarStatus();
});

document.querySelector('#connectCalendarBtn').addEventListener('click', async () => {
  await connectGoogleCalendar();
});

document.querySelector('#disconnectCalendarBtn').addEventListener('click', async () => {
  await disconnectGoogleCalendar();
});

document.querySelectorAll('.app-nav-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    await switchView(btn.dataset.view);
  });
});

document.querySelector('#todayToggleBtn').addEventListener('click', () => {
  setTodayCollapsed(!state.todayCollapsed);
});

const toggleEl = document.querySelector('#viewModeToggle');
if (toggleEl) {
  toggleEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (btn) setViewMode(btn.dataset.mode);
  });
}

loginForm.addEventListener('submit', submitLogin);
document.querySelector('#logoutBtn').addEventListener('click', logout);

fields.syncCalendar.addEventListener('change', updateCalendarSyncFields);
fields.dueDate.addEventListener('change', updateCalendarSyncFields);

board.addEventListener('change', async (e) => {
  const id = e.target.dataset.statusId;
  if (!id) return;
  await api(`/api/tasks/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: e.target.value }),
  });
  await loadTasks();
});

board.addEventListener('click', async (e) => {
  const id = e.target.dataset.openId;
  if (!id) return;
  await openTask(Number(id));
});

document.querySelector('#todayGrid').addEventListener('click', async (e) => {
  const id = e.target.dataset.openId;
  if (!id) return;
  await openTask(Number(id));
});

setInterval(render, 60000);
init();
