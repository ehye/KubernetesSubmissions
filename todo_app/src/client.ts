// Browser code: requests go to todo-app, which proxies them to the cluster-only backend.
export const todoClientScript = `
const form = document.getElementById('todo-form');
const input = document.getElementById('todo-input');
const button = document.getElementById('todo-send');
const list = document.getElementById('todo-list');
const status = document.getElementById('todo-status');
const breakButton = document.getElementById('break-app');
const breakStatus = document.getElementById('break-status');

breakButton.addEventListener('click', async () => {
  breakButton.disabled = true;
  try {
    const response = await fetch('/break', { method: 'POST' });
    if (!response.ok) throw new Error();
    breakStatus.textContent = 'Frontend marked unhealthy. Refresh after Kubernetes restarts it.';
  } catch {
    breakStatus.textContent = 'Could not break the app. Try again.';
    breakButton.disabled = false;
  }
});

function renderTodos(todos) {
  list.replaceChildren();
  for (const todo of todos) {
    const item = document.createElement('li');
    const label = document.createElement(todo.done ? 's' : 'span');
    label.textContent = todo.text;
    item.append(label);
    if (!todo.done) {
      const mark = document.createElement('button');
      mark.type = 'button';
      mark.textContent = 'Mark done';
      mark.addEventListener('click', async () => {
        mark.disabled = true;
        try {
          const response = await fetch('/todos/' + encodeURIComponent(todo.id), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ done: true }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Unable to mark todo done');
          const completed = document.createElement('s');
          completed.textContent = result.text;
          item.replaceChildren(completed);
          status.textContent = 'Todo marked done.';
        } catch (error) {
          status.textContent = error.message || 'Unable to mark todo done. Please try again.';
          mark.disabled = false;
        }
      });
      item.append(mark);
    }
    list.append(item);
  }
}

async function loadTodos() {
  button.disabled = true;
  status.textContent = 'Loading todos...';
  try {
    const response = await fetch('/todos', { cache: 'no-store' });
    const todos = await response.json();
    if (!response.ok) throw new Error(todos.error || 'Unable to load todos');
    if (!Array.isArray(todos)) throw new Error('Invalid todo list');
    renderTodos(todos);
    status.textContent = todos.length === 0 ? 'No todos yet.' : '';
    return true;
  } catch (error) {
    status.textContent = error.message || 'Unable to load todos. Please refresh.';
    return false;
  } finally {
    button.disabled = false;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (button.disabled) return;
  const text = input.value.trim();
  if (!text || input.value.length > 140) {
    status.textContent = 'Todo text must contain 1 to 140 characters.';
    return;
  }

  button.disabled = true;
  input.disabled = true;
  status.textContent = 'Saving todo...';
  try {
    const response = await fetch('/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to save todo');
    input.value = '';
    if (await loadTodos()) status.textContent = 'Todo added.';
  } catch (error) {
    status.textContent = error.message || 'Unable to save todo. Please try again.';
  } finally {
    input.disabled = false;
    button.disabled = false;
    input.focus();
  }
});

void loadTodos();
`;
