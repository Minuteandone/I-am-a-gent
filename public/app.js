const messagesEl = document.querySelector('#messages');
const form = document.querySelector('#message-form');
const input = document.querySelector('#message-input');
const agentButton = document.querySelector('#agent-button');
const template = document.querySelector('#message-template');
const toolEventsEl = document.querySelector('#tool-events');
const modelNameEl = document.querySelector('#model-name');
const endpointEl = document.querySelector('#endpoint');

let state = { messages: [] };

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || 'Request failed.');
  }
  return body;
}

function formatTime(iso) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(iso));
}

function renderReactions(message, row) {
  row.replaceChildren();
  Object.entries(message.reactions || {}).forEach(([emoji, actors]) => {
    const pill = document.createElement('span');
    pill.className = 'reaction-pill';
    pill.title = actors.join(', ');
    pill.textContent = `${emoji} ${actors.length}`;
    row.append(pill);
  });
}

function renderMessages() {
  messagesEl.replaceChildren();

  if (state.messages.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<p>Start a conversation, then let the local agent use its chat tools.</p>';
    messagesEl.append(empty);
    return;
  }

  state.messages.forEach((message) => {
    const fragment = template.content.cloneNode(true);
    const article = fragment.querySelector('.message');
    const author = fragment.querySelector('.author');
    const created = fragment.querySelector('.created');
    const content = fragment.querySelector('.content');
    const reactionRow = fragment.querySelector('.reaction-row');

    article.classList.add(message.role);
    article.dataset.id = message.id;
    author.textContent = message.author;
    created.textContent = `${formatTime(message.createdAt)} · ${message.via}`;
    content.textContent = message.content;
    renderReactions(message, reactionRow);

    fragment.querySelectorAll('[data-emoji]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          const body = JSON.stringify({ emoji: button.dataset.emoji, actor: 'You' });
          const result = await api(`/api/messages/${message.id}/reactions`, { method: 'POST', body });
          state.messages = result.messages;
          renderMessages();
        } catch (error) {
          renderError(error.message);
        }
      });
    });

    messagesEl.append(fragment);
  });
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderToolEvents(events = []) {
  toolEventsEl.replaceChildren();
  if (events.length === 0) {
    toolEventsEl.textContent = 'No tool calls in the latest agent turn.';
    return;
  }

  events.forEach((event) => {
    const entry = document.createElement('div');
    entry.className = 'event';
    entry.innerHTML = `<strong>${event.name}</strong><br><code></code>`;
    entry.querySelector('code').textContent = JSON.stringify(event.args);
    toolEventsEl.append(entry);
  });
}

function renderError(message) {
  toolEventsEl.innerHTML = '';
  const entry = document.createElement('div');
  entry.className = 'event error';
  entry.textContent = message;
  toolEventsEl.append(entry);
}

async function loadConfig() {
  const config = await api('/api/config');
  modelNameEl.textContent = config.model;
  endpointEl.textContent = config.baseURL;
}

async function loadMessages() {
  const result = await api('/api/messages');
  state.messages = result.messages;
  renderMessages();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const content = input.value.trim();
  if (!content) {
    return;
  }

  input.value = '';
  try {
    const result = await api('/api/messages', {
      method: 'POST',
      body: JSON.stringify({ content, author: 'You' }),
    });
    state.messages = result.messages;
    renderMessages();
  } catch (error) {
    renderError(error.message);
  }
});

agentButton.addEventListener('click', async () => {
  agentButton.disabled = true;
  agentButton.textContent = 'Agent thinking…';
  try {
    const result = await api('/api/agent/respond', { method: 'POST' });
    state.messages = result.messages;
    renderMessages();
    renderToolEvents(result.toolEvents);
  } catch (error) {
    renderError(error.message);
  } finally {
    agentButton.disabled = false;
    agentButton.textContent = 'Ask agent';
  }
});

await Promise.all([loadConfig(), loadMessages()]);
