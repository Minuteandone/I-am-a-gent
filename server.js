import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');

const port = Number(process.env.PORT || 3000);
const model = process.env.OPENAI_MODEL || 'gpt-oss-120b';
const baseURL = process.env.OPENAI_BASE_URL || 'http://localhost:11434/v1';
const apiKey = process.env.OPENAI_API_KEY || 'local-gpt-oss';
const messages = [];

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function now() {
  return new Date().toISOString();
}

function createMessage({ role, content, author = role, via = 'user' }) {
  const message = {
    id: randomUUID(),
    role,
    author,
    content: String(content || '').trim(),
    createdAt: now(),
    reactions: {},
    via,
  };
  messages.push(message);
  return message;
}

function findMessage(id) {
  return messages.find((message) => message.id === id);
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
  return message;
}

function checkMessages({ startTime, endTime, limit = 20 }) {
  const start = startTime ? Date.parse(startTime) : Number.NEGATIVE_INFINITY;
  const end = endTime ? Date.parse(endTime) : Number.POSITIVE_INFINITY;
  const max = Math.min(Math.max(Number(limit) || 20, 1), 100);

  return messages
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
  return messages
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
  return messages.map((message) => ({ messageId: message.id, reactions: message.reactions }));
}

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

const toolHandlers = {
  chat_check: (args) => checkMessages(args),
  chat_search: (args) => searchMessages(args),
  chat_react: (args) => addReaction({ ...args, actor: args.actor || 'agent' }),
  chat_reactions: (args) => reactionSummary(args),
  chat_send: (args) => createMessage({ role: 'assistant', author: 'Agent', content: args.content, via: 'tool:chat.send' }),
};

function parseToolArguments(rawArguments) {
  if (!rawArguments) {
    return {};
  }
  try {
    return JSON.parse(rawArguments);
  } catch {
    return {};
  }
}

function toModelMessages() {
  return [
    {
      role: 'system',
      content: [
        'You are a local chat agent powered by gpt-oss-120b.',
        'You can inspect, search, react to, and send chat messages using the supplied chat tools.',
        'Prefer chat_send when you want your reply to appear in the shared chat.',
        'Use chat_react sparingly when an emoji reaction is useful.',
      ].join(' '),
    },
    ...messages.slice(-50).map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: `${message.author} (${message.id}, ${message.createdAt}): ${message.content}`,
    })),
  ];
}

async function createChatCompletion(payload) {
  const response = await fetch(`${baseURL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
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

async function runAgentTurn() {
  const transcript = toModelMessages();
  const toolEvents = [];

  const first = await createChatCompletion({
    model,
    messages: transcript,
    tools,
    tool_choice: 'auto',
  });

  const assistantMessage = first.choices?.[0]?.message;
  const toolCalls = assistantMessage?.tool_calls || [];

  if (toolCalls.length === 0) {
    const content = assistantMessage?.content || 'I am here.';
    const message = createMessage({ role: 'assistant', author: 'Agent', content, via: 'model' });
    return { messages, toolEvents, agentMessageId: message.id };
  }

  const followUpMessages = [...transcript, assistantMessage];
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
    followUpMessages.push({
      role: 'tool',
      tool_call_id: call.id,
      content: JSON.stringify(result),
    });
  }

  if (toolEvents.some((event) => event.name === 'chat.send')) {
    return { messages, toolEvents };
  }

  const second = await createChatCompletion({
    model,
    messages: followUpMessages,
  });
  const content = second.choices?.[0]?.message?.content || 'Done.';
  const message = createMessage({ role: 'assistant', author: 'Agent', content, via: 'model-after-tools' });
  return { messages, toolEvents, agentMessageId: message.id };
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

function sendJson(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data));
}

function sendStatic(response, requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, `http://localhost:${port}`).pathname);
  const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = path.normalize(path.join(publicDir, relativePath));

  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    sendJson(response, 404, { error: 'Not found.' });
    return;
  }

  const ext = path.extname(filePath);
  response.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
  createReadStream(filePath).pipe(response);
}

async function handleApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/config') {
    sendJson(response, 200, { model, baseURL });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/messages') {
    sendJson(response, 200, { messages });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/messages') {
    const body = await readJsonBody(request);
    const { content, author = 'You' } = body;
    if (!String(content || '').trim()) {
      sendJson(response, 400, { error: 'Message content is required.' });
      return;
    }
    const message = createMessage({ role: 'user', author, content, via: 'user' });
    sendJson(response, 201, { message, messages });
    return;
  }

  const reactionMatch = url.pathname.match(/^\/api\/messages\/([^/]+)\/reactions$/);
  if (request.method === 'POST' && reactionMatch) {
    try {
      const body = await readJsonBody(request);
      const message = addReaction({
        messageId: reactionMatch[1],
        emoji: body.emoji,
        actor: body.actor || 'You',
      });
      sendJson(response, 200, { message, messages });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/agent/respond') {
    try {
      const result = await runAgentTurn();
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 502, {
        error: `Could not reach local ${model} at ${baseURL}. Start your local OpenAI-compatible server or update OPENAI_BASE_URL.`,
        details: error.message,
        messages,
      });
    }
    return;
  }

  sendJson(response, 404, { error: 'Not found.' });
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://localhost:${port}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url);
      return;
    }
    sendStatic(response, request.url);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
}).listen(port, () => {
  console.log(`AI chat interface listening on http://localhost:${port}`);
  console.log(`Agent model: ${model}`);
  console.log(`OpenAI-compatible base URL: ${baseURL}`);
});
