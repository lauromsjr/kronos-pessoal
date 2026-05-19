// ============================================
// KRONOS — app.js v4
// Subtarefas · Barra de progresso · Concluídas
// ============================================

const lists = { Tarefa: 'Tarefas', Backlog: 'Backlog', Ideia: 'Ideias', Concluida: 'Concluídas' };

const state = {
  list:      'Tarefa',
  company:   '',
  impact:    '',
  tasks:     [],
  allTasks:  [],
  subtasks:  {}, // taskId → []
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
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) q.set(k, v); });
  return q.toString();
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

function impactChipClass(impact) {
  if (impact === 'Alto')  return 'chip-impact-alto';
  if (impact === 'Médio') return 'chip-impact-medio';
  return 'chip-impact-baixo';
}

function sortByPriority(tasks) {
  const order = { Alto: 0, 'Médio': 1, Baixo: 2 };
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

  const counts = { Tarefa: 0, Backlog: 0, Ideia: 0, Concluida: 0 };

  // Busca concluídas separado
  api('/api/tasks?list=Concluida').then(r => {
    const concluidas = r?.data || [];
    document.querySelector('#tabBadgeConcluida').textContent = concluidas.length;
  }).catch(() => {});

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

  // Busca concluídas para o progresso real
  api('/api/tasks?list=Concluida').then(r => {
    const done = r?.data?.length || 0;
    const total = tarefasAll.length + done;
    const realPct = total > 0 ? Math.round((done / total) * 100) : 0;
    const offset = 163.4 - (realPct / 100) * 163.4;
    document.querySelector('#progressRing').style.strokeDashoffset = offset;
    document.querySelector('#progressPct').textContent = `${realPct}%`;
    document.querySelector('#progressSub').textContent = `${done}/${total} tarefas`;
  }).catch(() => {
    const offset = 163.4 - (pct / 100) * 163.4;
    document.querySelector('#progressRing').style.strokeDashoffset = offset;
    document.querySelector('#progressPct').textContent = `${pct}%`;
  });

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
          <span class="badge ${task.company}">${task.company}</span>
          <span class="chip ${impactCls}">${task.impact}</span>
        </div>
        <h3>${escapeHtml(task.title)}</h3>
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

function render() {
  board.innerHTML = '';
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

// ============================================
// LOAD
// ============================================

async function loadTasks() {
  const params = state.list === 'Concluida'
    ? { list: 'Concluida' }
    : { list: state.list, company: state.company, impact: state.impact };

  const result = await api(`/api/tasks?${qs(params)}`);
  state.tasks = result.data;
  await loadAllTasks();
  updateMetrics();
  render();

  // Oculta legenda e filtros na aba concluídas
  const isConcluida = state.list === 'Concluida';
  document.querySelector('#urgencyLegend').style.display = isConcluida ? 'none' : '';
  document.querySelector('#mainFilters').style.display   = isConcluida ? 'none' : '';
  document.querySelector('#addTaskBtn').style.display    = isConcluida ? 'none' : '';
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

  ul.innerHTML = currentSubtasks.map(sub => `
    <li class="subtask-item ${sub.done ? 'done' : ''}" data-sub-id="${sub.id}">
      <input type="checkbox" ${sub.done ? 'checked' : ''} data-toggle-sub="${sub.id}" />
      <span>${escapeHtml(sub.title)}</span>
      <button type="button" data-del-sub="${sub.id}" title="Remover">×</button>
    </li>
  `).join('');
}

async function loadSubtasks(taskId) {
  const result = await api(`/api/tasks/${taskId}/subtasks`);
  currentSubtasks = result.data || [];
  renderSubtaskList();
}

document.querySelector('#addSubtaskBtn').addEventListener('click', async () => {
  const input = document.querySelector('#newSubtaskInput');
  const title = input.value.trim();
  if (!title || !currentTaskId) return;
  const result = await api(`/api/tasks/${currentTaskId}/subtasks`, {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
  currentSubtasks.push(result.data);
  input.value = '';
  renderSubtaskList();
});

document.querySelector('#newSubtaskInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.querySelector('#addSubtaskBtn').click();
  }
});

document.querySelector('#subtaskList').addEventListener('change', async (e) => {
  const id = e.target.dataset.toggleSub;
  if (!id) return;
  const done = e.target.checked;
  await api(`/api/subtasks/${id}`, { method: 'PATCH', body: JSON.stringify({ done }) });
  const sub = currentSubtasks.find(s => s.id === Number(id));
  if (sub) sub.done = done;
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
  fields.company.value = 'IbogaLiv';
  fields.impact.value  = 'Médio';
  fields.list.value    = state.list === 'Concluida' ? 'Tarefa' : state.list;
  fields.status.value  = 'A fazer';
  fields.notes.value   = '';
  document.querySelector('#modalTitle').textContent = 'Nova tarefa';
  document.querySelector('#taskDetail').hidden      = true;
  document.querySelector('#deleteBtn').hidden       = true;
  document.querySelector('#subtasksSection').style.display = 'none';
  currentSubtasks = [];
  currentTaskId   = null;
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

  let taskId = fields.id.value;

  if (taskId) {
    await api(`/api/tasks/${taskId}`, { method: 'PUT', body: JSON.stringify(payload) });
  } else {
    const result = await api('/api/tasks', { method: 'POST', body: JSON.stringify(payload) });
    taskId = result.data.id;
    currentTaskId = taskId;

    // Salva subtarefas adicionadas antes do save
    for (const sub of currentSubtasks) {
      if (!sub.id) {
        await api(`/api/tasks/${taskId}/subtasks`, {
          method: 'POST',
          body: JSON.stringify({ title: sub.title }),
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

setInterval(render, 60000);
loadTasks();
