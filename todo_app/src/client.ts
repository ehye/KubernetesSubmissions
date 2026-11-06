// Browser code: requests go to todo-app, which proxies them to the cluster-only backend.
export const todoClientScript = `
const form = document.getElementById('todo-form');
const input = document.getElementById('todo-input');
const button = document.getElementById('todo-send');
const list = document.getElementById('todo-list');
const status = document.getElementById('todo-status');

function renderTodos(todos) {
  list.replaceChildren();
  for (const todo of todos) {
    const item = document.createElement('li');
    item.textContent = todo.text;
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
