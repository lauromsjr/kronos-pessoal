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
  dailyReview: null,
  dailyReviewHistory: [],
  weeklyReport: null,
  aiPrioritySuggestions: {},
  aiTaskPreview: null,
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
  selectionMode: false,
  selectedTaskIds: new Set(),
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
  recurrenceType: document.querySelector('#recurrenceTypeInput'),
  recurrenceInterval: document.querySelector('#recurrenceIntervalInput'),
  recurrenceNextDate: document.querySelector('#recurrenceNextDateInput'),
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
  document.querySelector('#openAiTaskModalBtn').hidden = view !== 'execution' || state.list === 'Concluida';

  document.querySelectorAll('.app-nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  if (view === 'settings' && !state.backupsLoaded) {
    await loadBackups();
  }

  if (view === 'settings') {
    await loadCalendarStatus();
  }
  updateBulkActionsBar();
}

function escapeHtml(v) {
  return String(v)
    .replaceAll('&','&amp;').replaceAll('<','&lt;')
    .replaceAll('>','&gt;').replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');
}

function selectedCount() {
  return state.selectedTaskIds.size;
}

function isTaskSelected(taskId) {
  return state.selectedTaskIds.has(Number(taskId));
}

function toggleSelectionMode(forceValue) {
  state.selectionMode = typeof forceValue === 'boolean' ? forceValue : !state.selectionMode;
  if (!state.selectionMode) state.selectedTaskIds.clear();
  updateBulkActionsBar();
  render();
}

function toggleTaskSelection(taskId, checked) {
  const id = Number(taskId);
  if (!id) return;
  const shouldSelect = typeof checked === 'boolean' ? checked : !state.selectedTaskIds.has(id);
  if (shouldSelect) state.selectedTaskIds.add(id);
  else state.selectedTaskIds.delete(id);
  updateBulkActionsBar();
}

function selectVisibleTasks() {
  state.tasks.forEach((task) => state.selectedTaskIds.add(task.id));
  updateBulkActionsBar();
  render();
}

function clearSelection() {
  state.selectedTaskIds.clear();
  updateBulkActionsBar();
  render();
}

async function deleteSelectedTasks() {
  const ids = [...state.selectedTaskIds];
  if (!ids.length) return;
  const count = ids.length;
  if (!confirm(`Excluir ${count} tarefas selecionadas? Esta ação apagará também as subtarefas e histórico dessas tarefas.`)) return;
  if (count >= 5) {
    const typed = prompt('Digite EXCLUIR para confirmar esta exclusão em massa:');
    if (typed !== 'EXCLUIR') return;
  }

  const result = await api('/api/tasks/bulk', {
    method: 'DELETE',
    body: JSON.stringify({ ids }),
  });
  alert(`${result.data.deleted_count} tarefas excluídas.`);
  state.selectedTaskIds.clear();
  state.selectionMode = false;
  updateBulkActionsBar();
  await loadTasks();
}

function updateBulkActionsBar() {
  const wrap = document.querySelector('#bulkActionsWrap');
  const bar = document.querySelector('#bulkActionsBar');
  const countEl = document.querySelector('#bulkSelectionCount');
  const toggleBtn = document.querySelector('#toggleSelectionModeBtn');
  if (!wrap || !bar || !countEl || !toggleBtn) return;

  wrap.hidden = state.activeView !== 'execution';
  toggleBtn.textContent = state.selectionMode ? 'Cancelar seleção' : 'Selecionar';
  bar.hidden = !state.selectionMode;
  countEl.textContent = `${selectedCount()} selecionadas`;
}

const SAO_PAULO_TZ = 'America/Sao_Paulo';
const CIVIL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseCivilDateParts(value) {
  const [year, month, day] = String(value || '').split('-').map(Number);
  if (!year || !month || !day) return null;
  return { year, month, day };
}

function civilDateAtSaoPauloNoon(value) {
  const parts = parseCivilDateParts(value);
  if (!parts) return null;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 15, 0, 0));
}

function parseDate(s) {
  if (!s) return null;
  const value = String(s).trim();
  if (!value) return null;
  if (CIVIL_DATE_RE.test(value)) return civilDateAtSaoPauloNoon(value);
  return new Date(value);
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
  if (!dateStr) return '';
  const value = String(dateStr).trim();

  if (CIVIL_DATE_RE.test(value)) {
    const parts = parseCivilDateParts(value);
    if (!parts) return '';
    return `${String(parts.day).padStart(2, '0')}/${String(parts.month).padStart(2, '0')}/${parts.year}`;
  }

  const d = parseDate(value);
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR', {
    timeZone: SAO_PAULO_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatDateTime(dateStr) {
  const d = parseDate(dateStr);
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', {
    timeZone: SAO_PAULO_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function dateKeySaoPaulo(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
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
  const due = civilDateAtSaoPauloNoon(dueDate);
  const today = civilDateAtSaoPauloNoon(dateKeySaoPaulo(new Date()));
  if (!due || !today) return '';

  const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  return '';
}

function dueDateText(dueDate) {
  const cls = dueDateClass(dueDate);
  const label = cls === 'overdue' ? 'Vencido' : cls === 'today' ? 'Hoje' : 'Prazo';
  return `${label}: ${formatDate(dueDate)}`;
}

function recurrenceLabel(type) {
  if (type === 'daily') return 'diaria';
  if (type === 'weekly') return 'semanal';
  if (type === 'monthly') return 'mensal';
  return '';
}

function recurrenceChip(task) {
  const label = recurrenceLabel(task.recurrence_type);
  return label ? `<span class="chip recurrence-chip">Recorrente: ${label}</span>` : '';
}

function addMonthsToDate(dateStr, months) {
  const parts = parseCivilDateParts(dateStr);
  if (!parts) return '';
  const date = new Date(Date.UTC(parts.year, parts.month - 1 + Number(months || 0), parts.day, 15, 0, 0));
  return dateKeySaoPaulo(date);
}

function addDays(dateStr, days) {
  const date = civilDateAtSaoPauloNoon(dateStr);
  if (!date) return '';
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return dateKeySaoPaulo(date);
}

function calculateRecurrenceNextDate() {
  const type = fields.recurrenceType.value;
  if (type === 'none') return '';

  const interval = Math.min(30, Math.max(1, Number(fields.recurrenceInterval.value || 1)));
  const base = fields.dueDate.value || dateKeySaoPaulo(new Date());
  if (type === 'daily') return addDays(base, interval);
  if (type === 'weekly') return addDays(base, interval * 7);
  if (type === 'monthly') return addMonthsToDate(base, interval);
  return '';
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
  const recurrence = recurrenceChip(task);
  return `
    <article class="today-task">
      <h3>${escapeHtml(task.title)}</h3>
      <div class="today-meta">
        ${taskCompanyBadge(task)}
        ${taskImpactChip(task)}
        <span class="chip">${task.status}</span>
        ${due}
        ${recurrence}
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

function dailyReviewStatusLabel(status) {
  if (status === 'started') return 'Em andamento';
  if (status === 'closed') return 'Encerrado';
  return 'Não iniciado';
}

function dailyCandidateTasks() {
  if (!state.today) return [];
  const map = new Map();
  [
    ...(state.today.overdue || []),
    ...(state.today.today || []),
    ...(state.today.in_progress || []),
    ...(state.today.high_priority || []),
  ].forEach((task) => {
    if (!map.has(task.id)) map.set(task.id, task);
  });
  return [...map.values()];
}

function taskById(id) {
  return dailyCandidateTasks().find((task) => task.id === id)
    || state.allTasks.find((task) => task.id === id)
    || state.tasks.find((task) => task.id === id);
}

function selectedPriorityTasks() {
  const ids = state.dailyReview?.selected_priority_task_ids || [];
  return ids.map((id) => taskById(id) || { id, title: `Tarefa #${id}`, company: null, impact: '-', status: '-' });
}

function renderDailyReview() {
  const review = state.dailyReview;
  const statusEl = document.querySelector('#dailyReviewStatus');
  const metaEl = document.querySelector('#dailyReviewMeta');
  const bodyEl = document.querySelector('#dailyReviewBody');
  const startBtn = document.querySelector('#startDayBtn');
  const closeBtn = document.querySelector('#closeDayBtn');
  const whatsappBtn = document.querySelector('#sendWhatsappSummaryBtn');
  const whatsappMsg = document.querySelector('#dailyWhatsappMessage');
  if (!review || !statusEl || !metaEl || !bodyEl) return;

  statusEl.textContent = dailyReviewStatusLabel(review.status);
  statusEl.dataset.status = review.status;
  metaEl.textContent = `${formatDate(review.review_date)} · ${dailyReviewStatusLabel(review.status)}`;
  startBtn.disabled = review.status === 'closed';
  closeBtn.disabled = review.status === 'not_started';
  whatsappBtn.hidden = review.status !== 'closed';
  whatsappBtn.disabled = review.status !== 'closed';
  whatsappMsg.textContent = review.status === 'closed' ? 'Envio manual: somente quando você confirmar.' : '';

  const priorities = selectedPriorityTasks();
  const prioritiesHtml = priorities.length
    ? `<div class="daily-priority-pills">${priorities.map(task => `<span>${escapeHtml(task.title)}</span>`).join('')}</div>`
    : '<p class="daily-empty">Nenhuma prioridade escolhida ainda.</p>';

  if (review.status === 'closed') {
    bodyEl.innerHTML = `
      ${prioritiesHtml}
      ${review.summary ? `<p class="daily-review-note"><strong>Resumo:</strong> ${escapeHtml(review.summary)}</p>` : ''}
      ${review.tomorrow_focus ? `<p class="daily-review-note"><strong>Foco de amanhã:</strong> ${escapeHtml(review.tomorrow_focus)}</p>` : ''}
    `;
    return;
  }

  bodyEl.innerHTML = prioritiesHtml;
}

async function sendWhatsappDailySummary() {
  if (!state.dailyReview?.review_date || state.dailyReview.status !== 'closed') return;
  const msgEl = document.querySelector('#dailyWhatsappMessage');
  if (!confirm('Enviar resumo do dia por WhatsApp?')) return;

  msgEl.textContent = 'Enviando resumo...';
  try {
    const result = await api('/api/daily-review/send-whatsapp-summary', {
      method: 'POST',
      body: JSON.stringify({ review_date: state.dailyReview.review_date }),
    });
    msgEl.textContent = result.message || 'Resumo enviado por WhatsApp.';
  } catch (err) {
    if (err.message === 'WhatsApp não configurado.') {
      msgEl.textContent = 'WhatsApp não configurado.';
      return;
    }
    msgEl.textContent = 'Não foi possível enviar o resumo.';
  }
}

async function loadDailyReview() {
  const result = await api('/api/daily-review/today');
  state.dailyReview = result.data || result;
  renderDailyReview();
}

function reviewPriorityTasks(review) {
  const ids = review?.selected_priority_task_ids || [];
  return ids.map((id) => taskById(id) || { id, title: `Tarefa #${id}`, company: null, impact: '-', status: '-' });
}

function reviewSummaryText(review) {
  if (review.summary) return review.summary;
  if (review.blockers) return `Bloqueios: ${review.blockers}`;
  if (review.tomorrow_focus) return `Foco: ${review.tomorrow_focus}`;
  return 'Sem resumo registrado.';
}

function renderDailyReviewHistory() {
  const list = document.querySelector('#dailyHistoryList');
  if (!list) return;

  list.innerHTML = state.dailyReviewHistory.length
    ? state.dailyReviewHistory.map((review) => `
      <article class="daily-history-item">
        <div class="daily-history-item-main">
          <div class="daily-history-item-head">
            <strong>${formatDate(review.review_date)}</strong>
            <span class="daily-review-status" data-status="${review.status}">${dailyReviewStatusLabel(review.status)}</span>
          </div>
          <p>${escapeHtml(reviewSummaryText(review))}</p>
          ${review.blockers ? `<small><strong>Bloqueios:</strong> ${escapeHtml(review.blockers)}</small>` : ''}
          ${review.tomorrow_focus ? `<small><strong>Foco de amanha:</strong> ${escapeHtml(review.tomorrow_focus)}</small>` : ''}
        </div>
        <button class="btn-secondary" type="button" data-review-date="${review.review_date}">Abrir</button>
      </article>
    `).join('')
    : '<p class="daily-empty">Nenhum registro diario encontrado.</p>';
}

async function loadDailyReviewHistory() {
  const result = await api('/api/daily-review/history?limit=14');
  state.dailyReviewHistory = result.data || [];
  renderDailyReviewHistory();
}

function weeklyMetric(label, value) {
  return `
    <div class="weekly-metric">
      <span>${label}</span>
      <strong>${value || 0}</strong>
    </div>
  `;
}

function renderWeeklyTask(task, dateField) {
  const dateValue = task[dateField] ? formatDateTime(task[dateField]) : '';
  return `
    <li>
      <strong>${escapeHtml(task.title)}</strong>
      <span>${companyLabel(task.company)} · ${task.impact || '-'}${dateValue ? ` · ${dateValue}` : ''}</span>
    </li>
  `;
}

function renderWeeklyTextItems(items, emptyText) {
  return items.length
    ? `<ul>${items.map(item => `
        <li>
          <strong>${formatDate(item.review_date)}</strong>
          <span>${escapeHtml(item.text)}</span>
        </li>
      `).join('')}</ul>`
    : `<p class="daily-empty">${emptyText}</p>`;
}

function renderWeeklyReport() {
  const report = state.weeklyReport;
  const rangeEl = document.querySelector('#weeklyReportRange');
  const summaryEl = document.querySelector('#weeklyReportSummary');
  const sectionsEl = document.querySelector('#weeklyReportSections');
  if (!rangeEl || !summaryEl || !sectionsEl) return;

  if (!report) {
    rangeEl.textContent = 'Resumo semanal indisponivel.';
    summaryEl.innerHTML = '';
    sectionsEl.innerHTML = '<p class="daily-empty">Ainda nao ha dados suficientes nesta semana.</p>';
    return;
  }

  const summary = report.summary || {};
  const hasData = [
    summary.tasks_created,
    summary.tasks_completed,
    summary.daily_reviews_started,
    summary.daily_reviews_closed,
    summary.priority_count,
    summary.blocker_count,
  ].some((value) => Number(value) > 0);

  rangeEl.textContent = `${formatDate(report.range.start)} a ${formatDate(report.range.end)}`;
  summaryEl.innerHTML = [
    weeklyMetric('Criadas', summary.tasks_created),
    weeklyMetric('Concluidas', summary.tasks_completed),
    weeklyMetric('Dias iniciados', summary.daily_reviews_started),
    weeklyMetric('Dias encerrados', summary.daily_reviews_closed),
    weeklyMetric('Prioridades', summary.priority_count),
    weeklyMetric('Bloqueios', summary.blocker_count),
  ].join('');

  if (!hasData) {
    sectionsEl.innerHTML = '<p class="daily-empty">Ainda nao ha dados suficientes nesta semana.</p>';
    return;
  }

  sectionsEl.innerHTML = `
    <section class="weekly-report-section">
      <h3>Bloqueios registrados</h3>
      ${renderWeeklyTextItems(report.blockers || [], 'Nenhum bloqueio registrado.')}
    </section>
    <section class="weekly-report-section">
      <h3>Foco dos proximos dias</h3>
      ${renderWeeklyTextItems(report.tomorrow_focus || [], 'Nenhum foco registrado.')}
    </section>
    <section class="weekly-report-section">
      <h3>Concluidas na semana</h3>
      ${(report.completed_tasks || []).length
        ? `<ul>${report.completed_tasks.slice(0, 8).map(task => renderWeeklyTask(task, 'completed_at')).join('')}</ul>`
        : '<p class="daily-empty">Nenhuma tarefa concluida nesta semana.</p>'}
    </section>
  `;
}

async function loadWeeklyReport() {
  state.weeklyReport = await api('/api/reports/weekly');
  renderWeeklyReport();
}

function openDailyReviewHistoryDetail(review) {
  const priorities = reviewPriorityTasks(review);
  const detail = document.querySelector('#dailyHistoryDetail');
  document.querySelector('#dailyHistoryModalTitle').textContent = `Registro de ${formatDate(review.review_date)}`;
  detail.innerHTML = `
    <div class="detail-row">
      <span class="detail-label">Status</span>
      <strong>${dailyReviewStatusLabel(review.status)}</strong>
    </div>
    <div class="detail-row">
      <span class="detail-label">Prioridades escolhidas</span>
      ${priorities.length
        ? `<div class="daily-priority-pills">${priorities.map(task => `<span>${escapeHtml(task.title)}</span>`).join('')}</div>`
        : '<p class="daily-empty">Nenhuma prioridade registrada.</p>'}
    </div>
    <div class="detail-row">
      <span class="detail-label">Resumo</span>
      <p>${escapeHtml(review.summary || 'Sem resumo registrado.')}</p>
    </div>
    <div class="detail-row">
      <span class="detail-label">Bloqueios / pendencias</span>
      <p>${escapeHtml(review.blockers || 'Sem bloqueios registrados.')}</p>
    </div>
    <div class="detail-row">
      <span class="detail-label">Foco de amanha</span>
      <p>${escapeHtml(review.tomorrow_focus || 'Sem foco registrado.')}</p>
    </div>
    <div class="daily-history-times">
      <span><strong>Inicio:</strong> ${review.started_at ? formatDateTime(review.started_at) : '-'}</span>
      <span><strong>Encerramento:</strong> ${review.ended_at ? formatDateTime(review.ended_at) : '-'}</span>
    </div>
  `;
  document.querySelector('#dailyHistoryModal').showModal();
}

function renderStartDayOptions() {
  const selected = new Set(state.dailyReview?.selected_priority_task_ids || []);
  const candidates = dailyCandidateTasks();
  const list = document.querySelector('#startPriorityList');
  const count = document.querySelector('#startDayCount');
  count.textContent = `${selected.size}/3 prioridades selecionadas`;

  list.innerHTML = candidates.length
    ? candidates.map((task) => `
      <label class="daily-task-option">
        <input type="checkbox" value="${task.id}" ${selected.has(task.id) ? 'checked' : ''} />
        <span>
          <strong>${escapeHtml(task.title)}</strong>
          <small>${companyLabel(task.company)} · ${task.impact} · ${task.status}</small>
          ${state.aiPrioritySuggestions[task.id] ? `<em class="daily-ai-reason">${escapeHtml(state.aiPrioritySuggestions[task.id])}</em>` : ''}
        </span>
      </label>
    `).join('')
    : '<p class="daily-empty">Nenhuma tarefa candidata para prioridade.</p>';

  document.querySelector('#startAgendaContext').innerHTML = state.calendarEvents.today.length
    ? state.calendarEvents.today.map((event) => {
        const { time } = formatEventTimeRange(event);
        return `<p class="daily-agenda-line"><strong>${time}</strong> ${escapeHtml(cleanCalendarTitle(event.title))}</p>`;
      }).join('')
    : '<p class="daily-empty">Nenhum compromisso hoje.</p>';
}

function updateStartDayCount() {
  document.querySelector('#startDayCount').textContent =
    `${document.querySelectorAll('#startPriorityList input:checked').length}/3 prioridades selecionadas`;
}

function openStartDayModal() {
  state.aiPrioritySuggestions = {};
  document.querySelector('#aiPriorityMessage').textContent = '';
  renderStartDayOptions();
  document.querySelector('#startDayModal').showModal();
}

async function suggestPrioritiesWithAi() {
  const button = document.querySelector('#suggestPrioritiesBtn');
  const message = document.querySelector('#aiPriorityMessage');
  button.disabled = true;
  message.textContent = 'Gerando sugestões...';

  try {
    const candidates = dailyCandidateTasks();
    const result = await api('/api/daily-review/suggest-priorities', {
      method: 'POST',
      body: JSON.stringify({ task_ids: candidates.map((task) => task.id) }),
    });

    state.aiPrioritySuggestions = {};
    (result.suggestions || []).slice(0, 3).forEach((suggestion) => {
      state.aiPrioritySuggestions[suggestion.task_id] = suggestion.reason;
    });

    renderStartDayOptions();
    document.querySelectorAll('#startPriorityList input').forEach((input) => {
      input.checked = Boolean(state.aiPrioritySuggestions[Number(input.value)]);
    });
    updateStartDayCount();
    message.textContent = Object.keys(state.aiPrioritySuggestions).length
      ? 'Sugestões aplicadas. Ajuste antes de salvar.'
      : 'A IA não encontrou prioridades claras.';
  } catch (err) {
    message.textContent = err.message === 'IA não configurada.' ? 'IA não configurada.' : 'Não foi possível gerar sugestões.';
  } finally {
    button.disabled = false;
  }
}

async function saveStartDay(event) {
  event.preventDefault();
  const ids = [...document.querySelectorAll('#startPriorityList input:checked')].map(input => Number(input.value));
  const result = await api('/api/daily-review/start', {
    method: 'POST',
    body: JSON.stringify({ selected_priority_task_ids: ids }),
  });
  state.dailyReview = result.data || result;
  document.querySelector('#startDayModal').close();
  renderDailyReview();
  await loadDailyReviewHistory();
  await loadWeeklyReport();
}

async function completedTasksToday() {
  const result = await api('/api/tasks?list=Concluida&page=1&limit=50');
  const todayKey = dateKeySaoPaulo(new Date());
  return (result.data || []).filter((task) => {
    const completed = parseDate(task.completed_at);
    return completed && dateKeySaoPaulo(completed) === todayKey;
  });
}

async function openCloseDayModal() {
  const priorities = selectedPriorityTasks();
  const completed = await completedTasksToday();
  const inProgress = state.today?.in_progress || [];
  const pendingPriorities = priorities.filter(task => task.status !== 'Concluída');
  document.querySelector('#closeDaySummary').innerHTML = `
    <div><strong>Prioridades:</strong> ${priorities.length ? priorities.map(task => escapeHtml(task.title)).join(' · ') : 'nenhuma'}</div>
    <div><strong>Concluídas hoje:</strong> ${completed.length}</div>
    <div><strong>Em andamento:</strong> ${inProgress.length}</div>
    <div><strong>Prioridades pendentes:</strong> ${pendingPriorities.length}</div>
  `;
  document.querySelector('#daySummaryInput').value = state.dailyReview?.summary || '';
  document.querySelector('#dayBlockersInput').value = state.dailyReview?.blockers || '';
  document.querySelector('#dayTomorrowFocusInput').value = state.dailyReview?.tomorrow_focus || '';
  document.querySelector('#closeDayModal').showModal();
}

async function saveCloseDay(event) {
  event.preventDefault();
  const result = await api('/api/daily-review/close', {
    method: 'POST',
    body: JSON.stringify({
      summary: document.querySelector('#daySummaryInput').value,
      blockers: document.querySelector('#dayBlockersInput').value,
      tomorrow_focus: document.querySelector('#dayTomorrowFocusInput').value,
    }),
  });
  state.dailyReview = result.data || result;
  document.querySelector('#closeDayModal').close();
  renderDailyReview();
  await loadDailyReviewHistory();
  await loadWeeklyReport();
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

function updateRecurrenceFields() {
  const type = fields.recurrenceType.value;
  const enabled = type !== 'none';
  const note = document.querySelector('#recurrenceNote');

  fields.recurrenceInterval.disabled = !enabled;
  fields.recurrenceNextDate.value = enabled ? calculateRecurrenceNextDate() : '';

  if (!enabled) {
    note.textContent = 'Ao concluir, a tarefa sera encerrada normalmente.';
    note.className = 'recurrence-note';
    return;
  }

  if (!fields.dueDate.value) {
    note.textContent = 'Defina um prazo para calcular a proxima ocorrencia.';
    note.className = 'recurrence-note warn';
    return;
  }

  note.textContent = `Ao concluir, uma nova tarefa sera criada para ${formatDate(fields.recurrenceNextDate.value)}.`;
  note.className = 'recurrence-note success';
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
      <button class="backup-restore" type="button" data-restore-backup="${escapeHtml(backup.filename)}">Restaurar</button>
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

async function restoreBackup(filename) {
  const warning = 'Esta ação substituirá o banco atual por este backup. Antes disso, o Kronos criará um backup de segurança do estado atual.';
  if (!confirm(`${warning}\n\nDeseja continuar?`)) return;

  const typed = prompt('Digite RESTAURAR para confirmar a restauração segura.');
  if (typed !== 'RESTAURAR') {
    setBackupMessage('Restauração cancelada.', 'error');
    return;
  }

  setBackupMessage('Restaurando backup com segurança...');
  try {
    const result = await api('/api/backups/restore', {
      method: 'POST',
      body: JSON.stringify({ filename }),
    });
    await loadBackups();
    setBackupMessage(
      `${result.message} Backup de segurança criado: ${result.safety_backup}. Recarregue a página para garantir que os dados atualizados sejam exibidos.`,
      'success'
    );
  } catch (err) {
    setBackupMessage('Não foi possível restaurar o backup. O banco atual foi preservado.', 'error');
    throw err;
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
  const recurrenceHtml = recurrenceChip(task);
  const selectionCheckbox = state.selectionMode
    ? `<label class="task-select-box"><input type="checkbox" data-select-task-id="${task.id}" ${isTaskSelected(task.id) ? 'checked' : ''} /></label>`
    : '';
  const selectedClass = state.selectionMode && isTaskSelected(task.id) ? 'task-selected' : '';

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
      <article class="task task-concluida ${selectedClass}" data-impact="${task.impact}">
        ${selectionCheckbox}
        <span class="priority-num">${num}</span>
        <div class="task-meta">
          <span class="badge ${badgeClass}">${company}</span>
          <span class="chip ${impactCls}">${task.impact}</span>
          ${recurrenceHtml}
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
    <article class="task ${selectedClass}" data-impact="${task.impact}">
      ${selectionCheckbox}
      <span class="priority-num">${num}</span>
      <div class="task-meta">
        <span class="badge ${badgeClass}">${company}</span>
        <span class="chip ${impactCls}">${task.impact}</span>
        <span class="chip">${task.status}</span>
        ${recurrenceHtml}
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
  const recurrenceHtml = recurrenceChip(task);
  const selectionCheckbox = state.selectionMode
    ? `<label class="task-select-box"><input type="checkbox" data-select-task-id="${task.id}" ${isTaskSelected(task.id) ? 'checked' : ''} /></label>`
    : '';
  const selectedClass = state.selectionMode && isTaskSelected(task.id) ? 'task-selected' : '';

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
    <article class="task kanban-card ${selectedClass}" data-impact="${task.impact}" draggable="${state.selectionMode ? 'false' : 'true'}" data-task-id="${task.id}">
      ${selectionCheckbox}
      <span class="kanban-drag-handle" aria-hidden="true" title="Arrastar">⋮⋮</span>
      <span class="priority-num">${index + 1}</span>
      <div class="task-meta">
        <span class="badge ${badgeClass}">${company}</span>
        <span class="chip ${impactCls}">${task.impact}</span>
        ${recurrenceHtml}
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
  updateBulkActionsBar();
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
  const visibleIds = new Set((state.tasks || []).map((task) => task.id));
  state.selectedTaskIds = new Set([...state.selectedTaskIds].filter((id) => visibleIds.has(id)));
  state.completedHasMore = Boolean(result.pagination?.has_more);
  await loadAllTasks();
  await loadStats();
  await loadToday();
  await loadDailyReview();
  await loadDailyReviewHistory();
  await loadWeeklyReport();
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
  document.querySelector('#openAiTaskModalBtn').hidden = state.activeView !== 'execution' || isConcluida;
  updateBulkActionsBar();
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
let tempSubtaskId = -1;

function isTemporarySubtask(subtask) {
  return Boolean(subtask?.temporary) || Number(subtask?.id) < 0;
}

function updateCompleteTaskButton() {
  const button = document.querySelector('#completeTaskBtn');
  if (!button) return;

  const shouldShow = Boolean(currentTaskId) && fields.status.value !== 'Concluída';
  button.hidden = !shouldShow;
  button.disabled = !shouldShow;
}

function renderSubtaskList() {
  const ul = document.querySelector('#subtaskList');
  const countEl = document.querySelector('#subtasksCount');
  const done = currentSubtasks.filter(s => s.done).length;
  countEl.textContent = `${done}/${currentSubtasks.length}`;

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
  if (!title) return;

  if (currentTaskId) {
    const result = await api(`/api/tasks/${currentTaskId}/subtasks`, {
      method: 'POST',
      body: JSON.stringify({ title, due_date: dueInput.value || null }),
    });
    currentSubtasks.push(result.data);
  } else {
    currentSubtasks.push({
      id: tempSubtaskId--,
      title,
      done: false,
      due_date: dueInput.value || null,
      temporary: true,
    });
  }

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
    const sub = currentSubtasks.find(s => s.id === Number(toggleId));
    if (sub) {
      if (isTemporarySubtask(sub)) {
        sub.done = Boolean(e.target.checked);
      } else {
        const updated = await api(`/api/subtasks/${toggleId}`, {
          method: 'PATCH',
          body: JSON.stringify({ done: e.target.checked }),
        });
        Object.assign(sub, updated.data);
      }
    }
  }

  if (dueId) {
    const sub = currentSubtasks.find(s => s.id === Number(dueId));
    if (sub) {
      if (isTemporarySubtask(sub)) {
        sub.due_date = e.target.value || null;
      } else {
        const updated = await api(`/api/subtasks/${dueId}`, {
          method: 'PATCH',
          body: JSON.stringify({ due_date: e.target.value || null }),
        });
        Object.assign(sub, updated.data);
      }
    }
  }

  renderSubtaskList();
});

document.querySelector('#subtaskList').addEventListener('click', async (e) => {
  const id = e.target.dataset.delSub;
  if (!id) return;
  const sub = currentSubtasks.find(s => s.id === Number(id));
  if (!sub) return;
  if (!isTemporarySubtask(sub)) {
    await api(`/api/subtasks/${id}`, { method: 'DELETE' });
  }
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
  fields.recurrenceType.value = 'none';
  fields.recurrenceInterval.value = '1';
  fields.recurrenceNextDate.value = '';
  fields.syncCalendar.checked = false;
  fields.calendarStartTime.value = '09:00';
  fields.calendarDuration.value = '60';
  fields.notes.value   = '';
  document.querySelector('#modalTitle').textContent = 'Nova tarefa';
  document.querySelector('#taskDetail').hidden      = true;
  document.querySelector('#deleteBtn').hidden       = true;
  document.querySelector('#subtasksSection').style.display = '';
  document.querySelector('#newSubtaskInput').value = '';
  document.querySelector('#newSubtaskDueDateInput').value = '';
  currentSubtasks = [];
  currentTaskId   = null;
  tempSubtaskId = -1;
  updateCompleteTaskButton();
  updateCalendarSyncFields();
  updateRecurrenceFields();
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
  fields.recurrenceType.value = task.recurrence_type || 'none';
  fields.recurrenceInterval.value = String(task.recurrence_interval || 1);
  fields.recurrenceNextDate.value = task.recurrence_next_date || '';
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
  updateCompleteTaskButton();
  updateCalendarSyncFields();
  updateRecurrenceFields();
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
    recurrence_type: fields.recurrenceType.value,
    recurrence_interval: fields.recurrenceType.value === 'none' ? 1 : Number(fields.recurrenceInterval.value || 1),
    recurrence_next_date: fields.recurrenceType.value === 'none' ? null : fields.recurrenceNextDate.value || null,
    sync_to_calendar: fields.syncCalendar.checked,
    calendar_start_time: fields.syncCalendar.checked ? fields.calendarStartTime.value || '09:00' : null,
    calendar_duration_min: fields.syncCalendar.checked ? Number(fields.calendarDuration.value || 60) : null,
    notes:     fields.notes.value,
  };

  let taskId = fields.id.value;
  const wasExistingTask = Boolean(taskId);

  if (taskId) {
    const result = await api(`/api/tasks/${taskId}`, { method: 'PUT', body: JSON.stringify(payload) });
    if (result.calendar_sync_failed) alert('Tarefa salva, mas não foi possível sincronizar com a agenda.');
  } else {
    const result = await api('/api/tasks', { method: 'POST', body: JSON.stringify(payload) });
    if (result.calendar_sync_failed) alert('Tarefa salva, mas não foi possível sincronizar com a agenda.');
    taskId = result.data.id;
    currentTaskId = taskId;

    for (const sub of currentSubtasks) {
      if (isTemporarySubtask(sub)) {
        await api(`/api/tasks/${taskId}/subtasks`, {
          method: 'POST',
          body: JSON.stringify({ title: sub.title, due_date: sub.due_date || null, done: Boolean(sub.done) }),
        });
      }
    }
  }

  if (wasExistingTask && taskId && currentSubtasks.some(isTemporarySubtask)) {
    for (const sub of currentSubtasks.filter(isTemporarySubtask)) {
      await api(`/api/tasks/${taskId}/subtasks`, {
        method: 'POST',
        body: JSON.stringify({ title: sub.title, due_date: sub.due_date || null, done: Boolean(sub.done) }),
      });
    }
  }

  modal.close();
  await loadTasks();
}

function resetAiTaskModal() {
  state.aiTaskPreview = null;
  document.querySelector('#aiTaskPromptInput').value = '';
  document.querySelector('#aiTaskFileInput').value = '';
  document.querySelector('#aiDefaultCompanyInput').value = '';
  document.querySelector('#aiDefaultListInput').value = 'Tarefa';
  document.querySelector('#commitAiTaskBtn').disabled = true;
  document.querySelector('#aiTaskPreview').innerHTML = '';
}

function renderAiTaskPreviewLoading(message) {
  document.querySelector('#aiTaskPreview').innerHTML = `<p class="ai-task-loading">${escapeHtml(message)}</p>`;
}

function renderAiTaskPreviewError(message) {
  document.querySelector('#aiTaskPreview').innerHTML = `<p class="ai-task-error">${escapeHtml(message)}</p>`;
}

function renderAiTaskPreview() {
  const preview = state.aiTaskPreview;
  const el = document.querySelector('#aiTaskPreview');
  if (!preview) {
    el.innerHTML = '';
    return;
  }

  const warnings = (preview.warnings || []).map((w) => `<li>${escapeHtml(w)}</li>`).join('');
  const tasks = (preview.tasks || []).map((task) => `
    <article class="ai-preview-task">
      <h3>${escapeHtml(task.title)}</h3>
      <p><strong>Empresa:</strong> ${escapeHtml(task.company || '-')} · <strong>Impacto:</strong> ${escapeHtml(task.impact || '-')} · <strong>Prazo da tarefa:</strong> ${task.due_date ? escapeHtml(formatDate(task.due_date)) : 'sem prazo'}</p>
      ${task.notes ? `<p>${escapeHtml(String(task.notes).slice(0, 220))}</p>` : ''}
      <ul class="ai-preview-subtasks">
        ${(task.subtasks || []).map((sub) => `<li>${escapeHtml(sub.title)} · <strong>Prazo:</strong> ${sub.due_date ? escapeHtml(formatDate(sub.due_date)) : 'sem prazo'}</li>`).join('')}
      </ul>
    </article>
  `).join('');

  el.innerHTML = `
    ${warnings ? `<div class="ai-task-warning"><strong>Avisos:</strong><ul>${warnings}</ul></div>` : ''}
    <div class="ai-preview-list">${tasks || '<p>Nenhuma tarefa identificada.</p>'}</div>
  `;
}

async function readAiTaskFile(file) {
  const allowed = ['.txt', '.md', '.csv'];
  const lower = file.name.toLowerCase();
  if (!allowed.some((ext) => lower.endsWith(ext))) {
    throw new Error('Formato de arquivo nao suportado. Use .txt, .md ou .csv.');
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Nao foi possivel ler o arquivo selecionado.'));
    reader.readAsText(file);
  });
}

async function analyzeTasksWithAi() {
  const analyzeBtn = document.querySelector('#analyzeAiTaskBtn');
  const commitBtn = document.querySelector('#commitAiTaskBtn');
  const promptInput = document.querySelector('#aiTaskPromptInput');
  const fileInput = document.querySelector('#aiTaskFileInput');
  const defaultCompany = document.querySelector('#aiDefaultCompanyInput').value || null;
  const defaultList = document.querySelector('#aiDefaultListInput').value || 'Tarefa';
  const basePrompt = promptInput.value.trim();

  analyzeBtn.disabled = true;
  commitBtn.disabled = true;
  renderAiTaskPreviewLoading('Analisando com IA...');

  try {
    let prompt = basePrompt;
    if (fileInput.files?.[0]) {
      const fileContent = await readAiTaskFile(fileInput.files[0]);
      prompt = [basePrompt, fileContent].filter(Boolean).join('\n\n');
    }

    const result = await api('/api/ai/tasks/preview', {
      method: 'POST',
      body: JSON.stringify({
        prompt,
        default_company: defaultCompany,
        default_list_type: defaultList,
      }),
    });

    state.aiTaskPreview = result.data || null;
    renderAiTaskPreview();
    commitBtn.disabled = !(state.aiTaskPreview?.tasks?.length);
  } catch (err) {
    renderAiTaskPreviewError(err.message || 'Erro ao analisar tarefas com IA.');
  } finally {
    analyzeBtn.disabled = false;
  }
}

async function commitAiTasks() {
  const preview = state.aiTaskPreview;
  if (!preview?.tasks?.length) return;
  const subtaskCount = preview.tasks.reduce((acc, task) => acc + (task.subtasks?.length || 0), 0);
  if (!confirm(`Criar ${preview.tasks.length} tarefas e ${subtaskCount} subtarefas?`)) return;

  const commitBtn = document.querySelector('#commitAiTaskBtn');
  commitBtn.disabled = true;
  renderAiTaskPreviewLoading('Criando tarefas...');

  try {
    const result = await api('/api/ai/tasks/commit', {
      method: 'POST',
      body: JSON.stringify({ tasks: preview.tasks }),
    });
    document.querySelector('#aiTaskModal').close();
    alert(`Importacao concluida: ${result.data.created_count} tarefas e ${result.data.created_subtasks_count} subtarefas.`);
    await loadTasks();
  } catch (err) {
    renderAiTaskPreviewError(err.message || 'Erro ao criar tarefas.');
    commitBtn.disabled = false;
  }
}

// ============================================
// EVENTOS
// ============================================

document.querySelector('#addTaskBtn').addEventListener('click', () => {
  resetForm();
  document.querySelector('#subtasksSection').style.display = '';
  modal.showModal();
});
document.querySelector('#openAiTaskModalBtn').addEventListener('click', () => {
  resetAiTaskModal();
  document.querySelector('#aiTaskModal').showModal();
});

document.querySelector('#closeModalBtn').addEventListener('click', () => modal.close());
document.querySelector('#cancelBtn').addEventListener('click',    () => modal.close());
document.querySelector('#closeAiTaskModalBtn').addEventListener('click', () => document.querySelector('#aiTaskModal').close());
document.querySelector('#cancelAiTaskBtn').addEventListener('click', () => document.querySelector('#aiTaskModal').close());
document.querySelector('#analyzeAiTaskBtn').addEventListener('click', analyzeTasksWithAi);
document.querySelector('#commitAiTaskBtn').addEventListener('click', commitAiTasks);
document.querySelector('#aiTaskFileInput').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    await readAiTaskFile(file);
  } catch (err) {
    renderAiTaskPreviewError(err.message || 'Arquivo invalido.');
    e.target.value = '';
  }
});
document.querySelector('#completeTaskBtn').addEventListener('click', async () => {
  if (!currentTaskId) return;
  if (!confirm('Marcar esta tarefa como concluída?')) return;

  try {
    await api(`/api/tasks/${currentTaskId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'Concluída' }),
    });
    modal.close();
    await loadTasks();
  } catch (err) {
    console.error('Erro ao concluir tarefa pelo modal:', err);
    alert('Não foi possível concluir a tarefa. Recarregando dados...');
    await loadTasks();
  }
});

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

document.querySelector('#backupList').addEventListener('click', async (e) => {
  const button = e.target.closest('[data-restore-backup]');
  if (!button) return;
  await restoreBackup(button.dataset.restoreBackup);
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

document.querySelector('#startDayBtn').addEventListener('click', () => {
  openStartDayModal();
});

document.querySelector('#closeDayBtn').addEventListener('click', async () => {
  await openCloseDayModal();
});

document.querySelector('#closeStartDayBtn').addEventListener('click', () => document.querySelector('#startDayModal').close());
document.querySelector('#cancelStartDayBtn').addEventListener('click', () => document.querySelector('#startDayModal').close());
document.querySelector('#closeCloseDayBtn').addEventListener('click', () => document.querySelector('#closeDayModal').close());
document.querySelector('#cancelCloseDayBtn').addEventListener('click', () => document.querySelector('#closeDayModal').close());
document.querySelector('#closeDailyHistoryBtn').addEventListener('click', () => document.querySelector('#dailyHistoryModal').close());
document.querySelector('#doneDailyHistoryBtn').addEventListener('click', () => document.querySelector('#dailyHistoryModal').close());
document.querySelector('#suggestPrioritiesBtn').addEventListener('click', async () => {
  await suggestPrioritiesWithAi();
});
document.querySelector('#sendWhatsappSummaryBtn').addEventListener('click', async () => {
  await sendWhatsappDailySummary();
});
document.querySelector('#refreshDailyHistoryBtn').addEventListener('click', async () => {
  await loadDailyReviewHistory();
});
document.querySelector('#refreshWeeklyReportBtn').addEventListener('click', async () => {
  await loadWeeklyReport();
});
document.querySelector('#startDayForm').addEventListener('submit', saveStartDay);
document.querySelector('#closeDayForm').addEventListener('submit', saveCloseDay);

document.querySelector('#dailyHistoryList').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-review-date]');
  if (!btn) return;

  try {
    const review = await api(`/api/daily-review/${btn.dataset.reviewDate}`);
    openDailyReviewHistoryDetail(review.data || review);
  } catch (err) {
    alert('Registro diario nao encontrado.');
  }
});

document.querySelector('#startPriorityList').addEventListener('change', (e) => {
  const checked = [...document.querySelectorAll('#startPriorityList input:checked')];
  if (checked.length > 3) {
    e.target.checked = false;
    alert('Escolha no máximo 3 prioridades.');
  }
  updateStartDayCount();
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
fields.status.addEventListener('change', updateCompleteTaskButton);
fields.dueDate.addEventListener('change', () => {
  updateCalendarSyncFields();
  updateRecurrenceFields();
});
fields.recurrenceType.addEventListener('change', updateRecurrenceFields);
fields.recurrenceInterval.addEventListener('input', updateRecurrenceFields);

board.addEventListener('change', async (e) => {
  const selectTaskId = e.target.dataset.selectTaskId;
  if (selectTaskId) {
    toggleTaskSelection(Number(selectTaskId), Boolean(e.target.checked));
    render();
    return;
  }

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

document.querySelector('#toggleSelectionModeBtn').addEventListener('click', () => {
  toggleSelectionMode();
});
document.querySelector('#selectVisibleTasksBtn').addEventListener('click', () => {
  selectVisibleTasks();
});
document.querySelector('#clearSelectionBtn').addEventListener('click', () => {
  clearSelection();
});
document.querySelector('#deleteSelectedTasksBtn').addEventListener('click', async () => {
  await deleteSelectedTasks();
});

setInterval(render, 60000);
init();
