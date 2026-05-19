// ============================================
// KRONOS — app.js v2
// ============================================

const lists = { Tarefa: 'Tarefas', Backlog: 'Backlog', Ideia: 'Ideias' };

const state = {
  list: 'Tarefa',
  company: '',
  impact: '',
  tasks: [],
  allTasks: [], // todas as tasks para métricas
};

const board   = document.querySelector('#taskBoard');
const modal   = document.querySelector('#taskModal');
const form    = document.querySelector('#taskForm');

const fields = {
  id:      document.querySelector('#taskId'),
  title:   document.querySelector('#titleInput'),
  company: document.querySelector('#companyInput'),
  impact:  document.querySelector('#impactInput'),
  list:    document.querySelector('#listInput'),
  status:  document.querySelector('#statusInput'),
  notes:   document.querySelector('#notesInput'),
};

// ============================================
// UTILS
// ============================================

function qs(params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) query.set(k, v); });
  return query.toString();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'Erro na API');
  }
  if (response.status === 204) return null;
  return response.json();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function daysSince(dateStr) {
  if (!dateStr) return 0;
  const d = new Date(`${dateStr}`.includes('T') ? dateStr : `${dateStr}Z`);
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function formatAge(days) {
  if (days < 1)  return 'hoje';
  if (days === 1) return '1d';
  if (days < 30) return `${days}d`;
  const m = Math.floor(days / 30);
  return `${m}m`;
}

function ageClass(days) {
  if (days < 3)  return 'fresh';
  if (days <= 7) return 'warn';
  return 'old';
}

function formatElapsed(task) {
  if (task.status !== 'Em andamento' || !task.started_at) return '';
  const started = new Date(`${task.started_at}`.includes('T') ? task.started_at : `${task.started_at}Z`);
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

function impactChipClass(impact) {
  if (impact === 'Alto')  return 'chip-impact-alto';
  if (impact === 'Médio') return 'chip-impact-medio';
  return 'chip-impact-baixo';
}

// ============================================
// MÉTRICAS
// ============================================

async function loadAllTasks() {
  const result = await api('/api/tasks');
  state.allTasks = result.data || [];
}

function updateMetrics() {
  const all = state.allTasks;

  // Contadores por lista
  const counts = { Tarefa: 0, Backlog: 0, Ideia: 0 };
  all.forEach(t => { if (counts[t.list_type] !== undefined) counts[t.list_type]++; });

  document.querySelector('#countTarefa').textContent  = counts.Tarefa;
  document.querySelector('#countBacklog').textContent = counts.Backlog;
  document.querySelector('#countIdeia').textContent   = counts.Ideia;

  // Tab badges
  document.querySelector('#tabBadgeTarefa').textContent  = counts.Tarefa;
  document.querySelector('#tabBadgeBacklog').textContent = counts.Backlog;
  document.querySelector('#tabBadgeIdeia').textContent   = counts.Ideia;

  // Sub-labels
  const emAndamento = all.filter(t => t.list_type === 'Tarefa' && t.status === 'Em andamento').length;
  document.querySelector('#subTarefa').textContent = emAndamento > 0
    ? `${emAndamento} em andamento`
    : 'nenhuma em andamento';

  // Progresso (tarefas concluídas / total tarefas)
  const tarefas   = all.filter(t => t.list_type === 'Tarefa');
  const concluidas = tarefas.filter(t => t.status === 'Concluída').length;
  const pct = tarefas.length > 0 ? Math.round((concluidas / tarefas.length) * 100) : 0;
  const circumference = 163.4;
  const offset = circumference - (pct / 100) * circumference;
  document.querySelector('#progressRing').style.strokeDashoffset = offset;
  document.querySelector('#progressPct').textContent = `${pct}%`;
  document.querySelector('#progressSub').textContent = `${concluidas}/${tarefas.length} tarefas`;

  // Distribuição por empresa
  const dist = {};
  all.forEach(t => {
    if (!dist[t.company]) dist[t.company] = 0;
    dist[t.company]++;
  });

  const colors = { IbogaLiv: '#22C55E', Olympus: '#D4AF37', PlugAI: '#818CF8', Pessoal: '#64748B' };
  const distBar = document.querySelector('#distBar');
  distBar.innerHTML = Object.entries(dist)
    .sort((a, b) => b[1] - a[1])
    .map(([company, count]) => `
      <div class="dist-item">
        <span class="dist-dot" style="background:${colors[company] || '#888'}"></span>
        <span>${company}</span>
        <span class="dist-num">${count}</span>
      </div>
    `).join('');

  // Metric card active state
  document.querySelectorAll('.metric-card[data-list]').forEach(card => {
    card.classList.toggle('active', card.dataset.list === state.list);
  });
}

// ============================================
// RENDER
// ============================================

function sortByImpact(tasks) {
  const order = { Alto: 0, Médio: 1, Baixo: 2 };
  return [...tasks].sort((a, b) => {
    const diff = (order[a.impact] ?? 3) - (order[b.impact] ?? 3);
    if (diff !== 0) return diff;
    // dentro do mesmo impacto: mais antigas primeiro
    return new Date(a.created_at) - new Date(b.created_at);
  });
}

function render() {
  board.innerHTML = '';

  if (!state.tasks.length) {
    board.innerHTML = `<p class="empty">Nenhum item em ${lists[state.list]}.</p>`;
    return;
  }

  const sorted = sortByImpact(state.tasks);

  for (const task of sorted) {
    const days = daysSince(task.created_at);
    const cls  = ageClass(days);
    const age  = formatAge(days);
    const elapsed = formatElapsed(task);
    const impactCls = impactChipClass(task.impact);

    const article = document.createElement('article');
    article.className = 'task';
    article.dataset.impact = task.impact;

    article.innerHTML = `
      <div class="task-meta">
        <span class="badge ${task.company}">${task.company}</span>
        <span class="chip ${impactCls}">${task.impact}</span>
        <span class="chip">${task.status}</span>
        <span class="task-age ${cls}" title="${days} dias no sistema">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          ${age}
        </span>
      </div>
      <h3>${escapeHtml(task.title)}</h3>
      <div class="task-footer">
        <select aria-label="Status da tarefa" data-status-id="${task.id}">
          ${['A fazer', 'Em andamento', 'Concluída', 'Pausada']
            .map(s => `<option ${s === task.status ? 'selected' : ''}>${s}</option>`)
            .join('')}
        </select>
        <button type="button" data-open-id="${task.id}" style="border:1px solid var(--line);border-radius:8px;padding:8px 14px;background:transparent;color:var(--muted);font-size:0.8rem;font-weight:700;">Editar</button>
        ${elapsed ? `<span class="elapsed">⏱ ${elapsed}</span>` : ''}
      </div>
    `;
    board.appendChild(article);
  }
}

// ============================================
// LOAD
// ============================================

async function loadTasks() {
  const query = qs({ list: state.list, company: state.company, impact: state.impact });
  const result = await api(`/api/tasks?${query}`);
  state.tasks = result.data;

  // Recarrega todas para métricas
  await loadAllTasks();
  updateMetrics();
  render();
}

// ============================================
// MODAL
// ============================================

function resetForm() {
  fields.id.value      = '';
  fields.title.value   = '';
  fields.company.value = 'IbogaLiv';
  fields.impact.value  = 'Médio';
  fields.list.value    = state.list;
  fields.status.value  = 'A fazer';
  fields.notes.value   = '';
  document.querySelector('#modalTitle').textContent   = 'Nova tarefa';
  document.querySelector('#taskDetail').hidden        = true;
  document.querySelector('#deleteBtn').hidden         = true;
}

async function openTask(id) {
  const result = await api(`/api/tasks/${id}`);
  const task = result.data;

  fields.id.value      = task.id;
  fields.title.value   = task.title;
  fields.company.value = task.company;
  fields.impact.value  = task.impact;
  fields.list.value    = task.list_type;
  fields.status.value  = task.status;
  fields.notes.value   = task.notes || '';

  document.querySelector('#modalTitle').textContent = 'Editar tarefa';
  document.querySelector('#taskDetail').hidden      = false;
  document.querySelector('#deleteBtn').hidden       = false;
  document.querySelector('#totalTime').textContent  = formatDuration(task.duration_min);

  document.querySelector('#historyList').innerHTML = task.history.length
    ? task.history
        .map(item => `<li>${item.from_status || 'Criada'} → ${item.to_status} · ${new Date(`${item.changed_at}`.includes('T') ? item.changed_at : `${item.changed_at}Z`).toLocaleString('pt-BR')}</li>`)
        .join('')
    : '<li>Sem mudanças registradas.</li>';

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
    notes:     fields.notes.value,
  };

  if (fields.id.value) {
    await api(`/api/tasks/${fields.id.value}`, { method: 'PUT', body: JSON.stringify(payload) });
  } else {
    await api('/api/tasks', { method: 'POST', body: JSON.stringify(payload) });
  }

  modal.close();
  await loadTasks();
}

// ============================================
// EVENTOS
// ============================================

document.querySelector('#addTaskBtn').addEventListener('click', () => {
  resetForm();
  modal.showModal();
});

document.querySelector('#closeModalBtn').addEventListener('click', () => modal.close());
document.querySelector('#cancelBtn').addEventListener('click', () => modal.close());

document.querySelector('#deleteBtn').addEventListener('click', async () => {
  if (!fields.id.value) return;
  await api(`/api/tasks/${fields.id.value}`, { method: 'DELETE' });
  modal.close();
  await loadTasks();
});

form.addEventListener('submit', saveTask);

// Tabs
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', async () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    state.list = tab.dataset.list;
    await loadTasks();
  });
});

// Metric cards clicáveis como tabs
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
  await openTask(id);
});

// Atualiza elapsed a cada minuto
setInterval(render, 60000);

// Init
loadTasks();
