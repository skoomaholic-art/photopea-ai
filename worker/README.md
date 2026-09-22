# Poster Markup AI Worker

Cloudflare Worker proxy for the Poster Markup AI panel. API keys are server-side secrets and must never be placed in `index.html` or `poster-app.js`.

Required secrets:

- `XAI_API_KEY` for Grok Imagine (`grok-imagine-image-2.0`)
- `OPENAI_API_KEY` for GPT Image (`gpt-image-1-mini`)

Optional variable:

- `ALLOWED_ORIGINS` - comma-separated additional origins. The production GitHub Pages origin is already allowed by default.

Endpoints:

- `GET /api/status` - returns only whether each provider is configured.
- `POST /api/generate` - accepts `{ provider, prompt, image, count }` and returns `{ images }`.

The official image APIs are paid. The UI therefore reports providers as unavailable until the corresponding server secret exists; it does not claim an unlimited/free API tier.
