# I-am-a-gent

A GitHub Pages-ready static website for a local GPT-OSS-120B chat agent. The site runs entirely in the browser: messages, reactions, and local model settings are stored in `localStorage`, and agent turns are sent directly from the page to your local OpenAI-compatible `gpt-oss-120b` endpoint.

## Agent tools

The browser exposes these OpenAI-compatible function tools to the local agent:

- `chat.check` — check messages in chat with a custom time range and number.
- `chat.search` — search for specific words or phrases.
- `chat.react` — add emoji reactions to messages.
- `chat.reactions` — check emoji reactions to messages.
- `chat.send` — send a message into the shared chat.

OpenAI-compatible function names cannot contain dots, so the API tool names are `chat_check`, `chat_search`, `chat_react`, `chat_reactions`, and `chat_send`. The UI displays them as the requested dotted names.

## Deploy with GitHub Pages

This repository includes a GitHub Actions workflow at `.github/workflows/pages.yml` that checks the browser JavaScript and deploys the static site to GitHub Pages.

1. Push this repository to GitHub.
2. In repository **Settings → Pages**, set **Build and deployment** to **GitHub Actions**.
3. Push to `main` or run the **Deploy GitHub Pages** workflow manually from the Actions tab.
4. Open the GitHub Pages URL in your browser.
5. Start a local OpenAI-compatible server for `gpt-oss-120b`.
6. In the website settings panel, set the local base URL, model name, and API key.

Default website settings:

- Base URL: `http://localhost:11434/v1`
- Model: `gpt-oss-120b`
- API key: `local-gpt-oss`

Your local model server must expose `POST /chat/completions` and allow CORS requests from the GitHub Pages origin. If your browser blocks the request, enable CORS on the local server or serve this static site locally from the same origin you allow.

## Run locally as a static site

No install step is required. Any static file server works, for example:

```bash
python3 -m http.server 3000
```

Then open <http://localhost:3000>.

## Development checks

```bash
npm test
```
