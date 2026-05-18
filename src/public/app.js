const lists = {
  Tarefa: 'Tarefas',
  Backlog: 'Backlog',
  Ideia: 'Ideias',
};

const state = {
  list: 'Tarefa',
  company: '',
  impact: '',
  tasks: [],
};

const board = document.querySelector('#taskBoard');
const modal = document.querySelector('#taskModal');
const form = document.querySelector('#taskForm');

const fields = {
  id: document.querySelector('#taskId'),
  title: document.querySelector('#titleInput'),
  company: document.querySelector('#companyInput'),
  impact: document.querySelector('#impactInput'),
  list: document.querySelector('#listInput'),
  status: document.querySelector('#statusInput'),
  notes: document.querySelector('#notesInput'),
};

function qs(params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
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

function formatElapsed(task) {
  if (task.status !== 'Em andamento' || !task.started_at) return '';
  const started = new Date(`${task.started_at}Z`);
  const minutes = Math.max(0, Math.floor((Date.now() - started.getTime()) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h ${rest}min`;
}

function formatDuration(minutes) {
  if (minutes === null || minutes === undefined) return '-';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}min`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function render() {
  board.innerHTML = '';

  if (!state.tasks.length) {
    board.innerHTML = `<p class="empty">Nenhum item em ${lists[state.list]}.</p>`;
    return;
  }

  for (const task of state.tasks) {
    const article = document.createElement('article');
    article.className = 'task';
    article.innerHTML = `
      <div class="task-meta">
        <span class="badge ${task.company}">${task.company}</span>
        <span class="chip">${task.impact}</span>
        <span class="chip">${task.status}</span>
      </div>
      <h3>${escapeHtml(task.title)}</h3>
      <div class="task-footer">
        <select aria-label="Status da tarefa" data-status-id="${task.id}">
          ${['A fazer', 'Em andamento', 'Concluída', 'Pausada']
            .map((status) => `<option ${status === task.status ? 'selected' : ''}>${status}</option>`)
            .join('')}
        </select>
        <button type="button" data-open-id="${task.id}">Editar</button>
        ${formatElapsed(task) ? `<span class="elapsed">${formatElapsed(task)}</span>` : ''}
      </div>
    `;
    board.appendChild(article);
  }
}

async function loadTasks() {
  const query = qs({ list: state.list, company: state.company, impact: state.impact });
  const result = await api(`/api/tasks?${query}`);
  state.tasks = result.data;
  render();
}

function resetForm() {
  fields.id.value = '';
  fields.title.value = '';
  fields.company.value = 'PlugAI';
  fields.impact.value = 'Médio';
  fields.list.value = state.list;
  fields.status.value = 'A fazer';
  fields.notes.value = '';
  document.querySelector('#modalTitle').textContent = 'Nova tarefa';
  document.querySelector('#taskDetail').hidden = true;
  document.querySelector('#deleteBtn').hidden = true;
}

async function openTask(id) {
  const result = await api(`/api/tasks/${id}`);
  const task = result.data;

  fields.id.value = task.id;
  fields.title.value = task.title;
  fields.company.value = task.company;
  fields.impact.value = task.impact;
  fields.list.value = task.list_type;
  fields.status.value = task.status;
  fields.notes.value = task.notes || '';

  document.querySelector('#modalTitle').textContent = 'Detalhe da tarefa';
  document.querySelector('#taskDetail').hidden = false;
  document.querySelector('#deleteBtn').hidden = false;
  document.querySelector('#totalTime').textContent = formatDuration(task.duration_min);
  document.querySelector('#historyList').innerHTML = task.history.length
    ? task.history
        .map((item) => `<li>${item.from_status || 'Criada'} -> ${item.to_status} · ${new Date(`${item.changed_at}Z`).toLocaleString('pt-BR')}</li>`)
        .join('')
    : '<li>Sem mudanças registradas.</li>';

  modal.showModal();
}

async function saveTask(event) {
  event.preventDefault();

  const payload = {
    title: fields.title.value,
    company: fields.company.value,
    impact: fields.impact.value,
    list_type: fields.list.value,
    status: fields.status.value,
    notes: fields.notes.value,
  };

  if (fields.id.value) {
    await api(`/api/tasks/${fields.id.value}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  } else {
    await api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  modal.close();
  await loadTasks();
}

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

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', async () => {
    document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active'));
    tab.classList.add('active');
    state.list = tab.dataset.list;
    await loadTasks();
  });
});

document.querySelector('#companyFilter').addEventListener('change', async (event) => {
  state.company = event.target.value;
  await loadTasks();
});

document.querySelector('#impactFilter').addEventListener('change', async (event) => {
  state.impact = event.target.value;
  await loadTasks();
});

board.addEventListener('change', async (event) => {
  const id = event.target.dataset.statusId;
  if (!id) return;
  await api(`/api/tasks/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: event.target.value }),
  });
  await loadTasks();
});

board.addEventListener('click', async (event) => {
  const id = event.target.dataset.openId;
  if (!id) return;
  await openTask(id);
});

setInterval(render, 60000);
loadTasks();
