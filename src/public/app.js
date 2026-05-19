// ============================================
// KRONOS — app.js v3 · Tema Claro + Prioridade
// ============================================

const lists = { Tarefa: 'Tarefas', Backlog: 'Backlog', Ideia: 'Ideias' };

const state = {
  list: 'Tarefa',
  company: '',
  impact: '',
  tasks: [],
  allTasks: [],
};

const board = document.querySelector('#taskBoard');
const modal = document.querySelector('#taskModal');
const form  = document.querySelector('#taskForm');

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
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Erro na API');
  }
  if (res.status === 204) return null;
  return res.json();
}

function escapeHtml(v) {
  return String(v)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
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
  if (days < 1)  return 'hoje';
  if (days === 1) return '1 dia';
  if (days < 30) return `${days} dias`;
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

function impactChipClass(impact) {
  if (impact === 'Alto')  return 'chip-impact-alto';
  if (impact === 'Médio') return 'chip-impact-medio';
  return 'chip-impact-baixo';
}

// ============================================
// ORDENAÇÃO POR IMPACTO
// Alto primeiro → Médio → Baixo
// Dentro do mesmo impacto: mais antigas primeiro (mais urgentes)
// ============================================

function sortByPriority(tasks) {
  const order = { Alto: 0, Médio: 1, Baixo: 2 };
  return [...tasks].sort((a, b) => {
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

function updateMetrics() {
  const all = state.allTasks;

  const counts = { Tarefa: 0, Backlog: 0, Ideia: 0 };
  all.forEach(t => { if (counts[t.list_type] !== undefined) counts[t.list_type]++; });

  document.querySelector('#countTarefa').textContent  = counts.Tarefa;
  document.querySelector('#countBacklog').textContent = counts.Backlog;
  document.querySelector('#countIdeia').textContent   = counts.Ideia;

  document.querySelector('#tabBadgeTarefa').textContent  = counts.Tarefa;
  document.querySelector('#tabBadgeBacklog').textContent = counts.Backlog;
  document.querySelector('#tabBadgeIdeia').textContent   = counts.Ideia;

  const emAndamento = all.filter(t => t.list_type === 'Tarefa' && t.status === 'Em andamento').length;
  document.querySelector('#subTarefa').textContent = emAndamento > 0
    ? `${emAndamento} em andamento`
    : 'nenhuma em andamento';

  // Progresso
  const tarefas    = all.filter(t => t.list_type === 'Tarefa');
  const concluidas = tarefas.filter(t => t.status === 'Concluída').length;
  const pct = tarefas.length > 0 ? Math.round((concluidas / tarefas.length) * 100) : 0;
  const offset = 163.4 - (pct / 100) * 163.4;
  document.querySelector('#progressRing').style.strokeDashoffset = offset;
  document.querySelector('#progressPct').textContent = `${pct}%`;
  document.querySelector('#progressSub').textContent = `${concluidas}/${tarefas.length} tarefas`;

  // Distribuição
  const dist = {};
  all.forEach(t => { dist[t.company] = (dist[t.company] || 0) + 1; });

  const colors = { IbogaLiv: '#16A34A', Olympus: '#B8960C', PlugAI: '#6366F1', Pessoal: '#64748B' };
  document.querySelector('#distBar').innerHTML = Object.entries(dist)
    .sort((a, b) => b[1] - a[1])
    .map(([company, count]) => `
      <div class="dist-item">
        <span class="dist-dot" style="background:${colors[company] || '#888'}"></span>
        <span>${company}</span>
        <span class="dist-num">${count}</span>
      </div>
    `).join('');

  // Active state nos metric cards
  document.querySelectorAll('.metric-card[data-list]').forEach(card => {
    card.classList.toggle('active', card.dataset.list === state.list);
  });
}

// ============================================
// RENDER
// ============================================

function render() {
  board.innerHTML = '';

  if (!state.tasks.length) {
    board.innerHTML = `<p class="empty">Nenhum item em ${lists[state.list]}.</p>`;
    return;
  }

  const sorted = sortByPriority(state.tasks);

  sorted.forEach((task, index) => {
    const days    = daysSince(task.created_at);
    const cls     = ageClass(days);
    const age     = formatAge(days);
    const elapsed = formatElapsed(task);
    const impactCls = impactChipClass(task.impact);
    const num     = index + 1;

    // Tooltip do tempo
    const ageTitle = days < 1
      ? 'Criada hoje'
      : `No sistema há ${age}`;

    const article = document.createElement('article');
    article.className = 'task';
    article.dataset.impact = task.impact;

    article.innerHTML = `
      <span class="priority-num">${num}</span>
      <div class="task-meta">
        <span class="badge ${task.company}">${task.company}</span>
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
      <div class="task-footer">
        <select aria-label="Status da tarefa" data-status-id="${task.id}">
          ${['A fazer', 'Em andamento', 'Concluída', 'Pausada']
            .map(s => `<option ${s === task.status ? 'selected' : ''}>${s}</option>`)
            .join('')}
        </select>
        <button class="btn-edit" type="button" data-open-id="${task.id}">Editar</button>
        ${elapsed ? `<span class="elapsed">⏱ ${elapsed}</span>` : ''}
      </div>
    `;
    board.appendChild(article);
  });
}

// ============================================
// LOAD
// ============================================

async function loadTasks() {
  const query = qs({ list: state.list, company: state.company, impact: state.impact });
  const result = await api(`/api/tasks?${query}`);
  state.tasks = result.data;
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
  document.querySelector('#modalTitle').textContent = 'Nova tarefa';
  document.querySelector('#taskDetail').hidden      = true;
  document.querySelector('#deleteBtn').hidden       = true;
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
        .map(item => {
          const d = parseDate(item.changed_at);
          const dateStr = d ? d.toLocaleString('pt-BR') : item.changed_at;
          return `<li>${item.from_status || 'Criada'} → ${item.to_status} · ${dateStr}</li>`;
        })
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

setInterval(render, 60000);
loadTasks();
