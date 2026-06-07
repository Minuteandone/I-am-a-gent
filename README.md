# I-am-a-gent

A local AI chat interface for a GPT-OSS-120B agent. The app provides a shared chat where the user can send messages and add emoji reactions, while the agent can call chat tools to inspect, search, react, read reactions, and send messages.

## Agent tools

The backend exposes these OpenAI-compatible tools to the local agent:

- `chat.check` — check messages in chat with a custom time range and number.
- `chat.search` — search for specific words or phrases.
- `chat.react` — add emoji reactions to messages.
- `chat.reactions` — check emoji reactions to messages.
- `chat.send` — send a message into the shared chat.

## Run locally

This project uses only built-in Node.js modules. Start an OpenAI-compatible local server for `gpt-oss-120b`, then run the web app:

```bash
OPENAI_BASE_URL=http://localhost:11434/v1 OPENAI_MODEL=gpt-oss-120b npm start
```

Open <http://localhost:3000>.

The default configuration is:

- `OPENAI_BASE_URL=http://localhost:11434/v1`
- `OPENAI_MODEL=gpt-oss-120b`
- `OPENAI_API_KEY=local-gpt-oss`

Override these environment variables if your local GPT-OSS-120B server uses a different OpenAI-compatible endpoint or model name.
