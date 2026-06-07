const storageKey = 'ai-agent-chat-state-v2';
const defaultConfig = {
  baseURL: 'http://localhost:11434/v1',
  model: 'gpt-oss-120b',
  apiKey: 'local-gpt-oss',
};

const messagesEl = document.querySelector('#messages');
const form = document.querySelector('#message-form');
const input = document.querySelector('#message-input');
const agentButton = document.querySelector('#agent-button');
const clearButton = document.querySelector('#clear-button');
const configForm = document.querySelector('#config-form');
const baseUrlInput = document.querySelector('#base-url');
const modelInput = document.querySelector('#model');
const apiKeyInput = document.querySelector('#api-key');
const template = document.querySelector('#message-template');
const toolEventsEl = document.querySelector('#tool-events');
const modelNameEl = document.querySelector('#model-name');
const endpointLabelEl = document.querySelector('#endpoint-label');

let state = loadState();

const tools = [
  {
    type: 'function',
    function: {
      name: 'chat_check',
      description: 'chat.check: Check messages in chat with a custom time range and number.',
      parameters: {
        type: 'object',
        properties: {
          startTime: { type: 'string', description: 'Inclusive ISO timestamp for the start of the range.' },
          endTime: { type: 'string', description: 'Inclusive ISO timestamp for the end of the range.' },
          limit: { type: 'number', description: 'Maximum number of messages to return.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'chat_search',
      description: 'chat.search: Search for specific words or phrases in chat messages.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Word or phrase to find.' },
          limit: { type: 'number', description: 'Maximum number of matching messages to return.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'chat_react',
      description: 'chat.react: Add emoji reactions to messages.',
      parameters: {
        type: 'object',
        properties: {
          messageId: { type: 'string', description: 'Target message id.' },
          emoji: { type: 'string', description: 'Emoji reaction to add.' },
          actor: { type: 'string', description: 'Who is reacting. Defaults to agent.' },
        },
        required: ['messageId', 'emoji'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'chat_reactions',
      description: 'chat.reactions: Check emoji reactions to messages.',
      parameters: {
        type: 'object',
        properties: {
          messageId: { type: 'string', description: 'Optional message id. Omit to list all reactions.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'chat_send',
      description: 'chat.send: Send a message into the chat as the agent.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Message text to send.' },
        },
        required: ['content'],
      },
    },
  },
];

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    return {
      config: { ...defaultConfig, ...saved?.config },
      messages: Array.isArray(saved?.messages) ? saved.messages : [],
    };
  } catch {
    return { config: { ...defaultConfig }, messages: [] };
  }
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function now() {
  return new Date().toISOString();
}

function createMessage({ role, content, author = role, via = 'user' }) {
  const message = {
    id: crypto.randomUUID(),
    role,
    author,
    content: String(content || '').trim(),
    createdAt: now(),
    reactions: {},
    via,
  };
  state.messages.push(message);
  saveState();
  return message;
}

function findMessage(id) {
  return state.messages.find((message) => message.id === id);
}

function addReaction({ messageId, emoji, actor }) {
  const message = findMessage(messageId);
  if (!message) {
    throw new Error(`Message ${messageId} was not found.`);
  }
  const normalizedEmoji = String(emoji || '').trim();
  const normalizedActor = String(actor || '').trim() || 'agent';
  if (!normalizedEmoji) {
    throw new Error('An emoji is required.');
  }
  message.reactions[normalizedEmoji] ??= [];
  if (!message.reactions[normalizedEmoji].includes(normalizedActor)) {
    message.reactions[normalizedEmoji].push(normalizedActor);
  }
  saveState();
  return message;
}

function checkMessages({ startTime, endTime, limit = 20 }) {
  const start = startTime ? Date.parse(startTime) : Number.NEGATIVE_INFINITY;
  const end = endTime ? Date.parse(endTime) : Number.POSITIVE_INFINITY;
  const max = Math.min(Math.max(Number(limit) || 20, 1), 100);

  return state.messages
    .filter((message) => {
      const created = Date.parse(message.createdAt);
      return created >= start && created <= end;
    })
    .slice(-max);
}

function searchMessages({ query, limit = 20 }) {
  const normalizedQuery = String(query || '').toLowerCase().trim();
  const max = Math.min(Math.max(Number(limit) || 20, 1), 100);
  if (!normalizedQuery) {
    return [];
  }
  return state.messages
    .filter((message) => message.content.toLowerCase().includes(normalizedQuery))
    .slice(-max);
}

function reactionSummary({ messageId }) {
  if (messageId) {
    const message = findMessage(messageId);
    if (!message) {
      throw new Error(`Message ${messageId} was not found.`);
    }
    return [{ messageId, reactions: message.reactions }];
  }
  return state.messages.map((message) => ({ messageId: message.id, reactions: message.reactions }));
}

const toolHandlers = {
  chat_check: (args) => checkMessages(args),
  chat_search: (args) => searchMessages(args),
  chat_react: (args) => addReaction({ ...args, actor: args.actor || 'agent' }),
  chat_reactions: (args) => reactionSummary(args),
  chat_send: (args) => createMessage({ role: 'assistant', author: 'Agent', content: args.content, via: 'tool:chat.send' }),
};

function toModelMessages() {
  return [
    {
      role: 'system',
      content: [
        'You are a local chat agent powered by gpt-oss-120b.',
        'You can inspect, search, react to, and send chat messages using the supplied chat tools.',
        'Function names use underscores for API compatibility: chat_check means chat.check, chat_search means chat.search, chat_react means chat.react, chat_reactions means chat.reactions, and chat_send means chat.send.',
        'Prefer chat_send when you want your reply to appear in the shared chat.',
        'Use chat_react sparingly when an emoji reaction is useful.',
      ].join(' '),
    },
    ...state.messages.slice(-50).map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: `${message.author} (${message.id}, ${message.createdAt}): ${message.content}`,
    })),
  ];
}

async function createChatCompletion(payload) {
  const response = await fetch(`${state.config.baseURL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${state.config.apiKey || 'local-gpt-oss'}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error?.message || body.error || `Local model request failed with ${response.status}.`);
  }
  return body;
}

function parseToolArguments(rawArguments) {
  if (!rawArguments) {
    return {};
  }
  try {
    return typeof rawArguments === 'string' ? JSON.parse(rawArguments) : rawArguments;
  } catch {
    return {};
  }
}

async function runAgentTurn() {
  let transcript = toModelMessages();
  const toolEvents = [];

  for (let step = 0; step < 5; step += 1) {
    const completion = await createChatCompletion({
      model: state.config.model,
      messages: transcript,
      tools,
      tool_choice: 'auto',
    });

    const assistantMessage = completion.choices?.[0]?.message;
    const toolCalls = assistantMessage?.tool_calls || [];

    if (toolCalls.length === 0) {
      const content = assistantMessage?.content || 'I am here.';
      const message = createMessage({ role: 'assistant', author: 'Agent', content, via: 'model' });
      return { toolEvents, agentMessageId: message.id };
    }

    transcript = [...transcript, assistantMessage];
    for (const call of toolCalls) {
      const name = call.function?.name;
      const args = parseToolArguments(call.function?.arguments);
      let result;
      try {
        result = toolHandlers[name](args);
      } catch (error) {
        result = { error: error.message };
      }
      toolEvents.push({ name: name.replace('_', '.'), args, result });
      transcript.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }

    if (toolEvents.some((event) => event.name === 'chat.send')) {
      return { toolEvents };
    }
  }

  const message = createMessage({
    role: 'assistant',
    author: 'Agent',
    content: 'I used several tools but did not produce a final chat message before the tool limit.',
    via: 'tool-limit',
  });
  return { toolEvents, agentMessageId: message.id };
}

function formatTime(iso) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(iso));
}

function renderConfig() {
  baseUrlInput.value = state.config.baseURL;
  modelInput.value = state.config.model;
  apiKeyInput.value = state.config.apiKey;
  modelNameEl.textContent = state.config.model;
  endpointLabelEl.textContent = state.config.baseURL;
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
      button.addEventListener('click', () => {
        try {
          addReaction({ messageId: message.id, emoji: button.dataset.emoji, actor: 'You' });
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

configForm.addEventListener('submit', (event) => {
  event.preventDefault();
  state.config = {
    baseURL: baseUrlInput.value.trim() || defaultConfig.baseURL,
    model: modelInput.value.trim() || defaultConfig.model,
    apiKey: apiKeyInput.value.trim() || defaultConfig.apiKey,
  };
  saveState();
  renderConfig();
  renderToolEvents([{ name: 'settings.saved', args: { baseURL: state.config.baseURL, model: state.config.model } }]);
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const content = input.value.trim();
  if (!content) {
    return;
  }

  input.value = '';
  createMessage({ role: 'user', author: 'You', content, via: 'user' });
  renderMessages();
});

agentButton.addEventListener('click', async () => {
  agentButton.disabled = true;
  agentButton.textContent = 'Agent thinking…';
  try {
    const result = await runAgentTurn();
    renderMessages();
    renderToolEvents(result.toolEvents);
  } catch (error) {
    renderError([
      error.message,
      'Check that your local gpt-oss-120b server is running, exposes an OpenAI-compatible /chat/completions endpoint, and allows browser CORS requests from this page.',
    ].join(' '));
  } finally {
    agentButton.disabled = false;
    agentButton.textContent = 'Ask agent';
  }
});

clearButton.addEventListener('click', () => {
  state.messages = [];
  saveState();
  renderMessages();
  renderToolEvents();
});

renderConfig();
renderMessages();
