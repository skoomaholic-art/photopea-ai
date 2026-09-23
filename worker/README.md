# Poster Editor Worker

Cloudflare Worker keeps provider credentials on the server side. GPT Image and Grok Image requests are routed through OpenRouter, so the browser never receives the OpenRouter key.

## Endpoints

- GET /api/status
- GET /api/posters?q=...
- GET /api/image?url=...
- POST /api/generate
- POST /api/remove-background

## OpenRouter

Set the secret once:

    npx wrangler secret put OPENROUTER_API_KEY

Do not put the key in `wrangler.toml`, frontend JavaScript, GitHub Pages variables, or committed `.env` files.

Non-secret model configuration lives in `wrangler.toml`:

- `OPENROUTER_BASE_URL`
- `OPENROUTER_SITE_URL`
- `OPENROUTER_APP_TITLE`
- `OPENROUTER_OPENAI_IMAGE_MODEL`
- `OPENROUTER_XAI_IMAGE_MODEL`

The UI still exposes OpenAI/Grok as separate choices, but both are requested through OpenRouter. Direct `OPENAI_API_KEY` and `XAI_API_KEY` secrets are no longer used by `/api/generate`.

## Other optional services

Configure only the providers you intend to use:

    npx wrangler secret put CARVE_API_KEY
    npx wrangler secret put REMOVAL_AI_KEY
    npx wrangler secret put TMDB_BEARER_TOKEN

TMDB remains disabled unless wrangler.toml has TMDB_COMMERCIAL_APPROVED = "true". Do not set it to true unless the deployment has a license that permits its commercial use.

Deploy with:

    npx wrangler deploy

The browser receives only availability booleans, selected model names, and API results. Secrets are never serialized to the client.


## Unified image search

New routes:

- `GET /api/images/search?q=The%20Godfather&year=1972&source=all`
- `GET /api/images/proxy?url=...`

Automatic adapters:

- TMDB - official API; requires `TMDB_ACCESS_TOKEN` or `TMDB_API_KEY` and `TMDB_COMMERCIAL_APPROVED=true`.
- Fanart.tv - official v3.2 API; requires `FANART_API_KEY` and optionally `FANART_CLIENT_KEY`. Movie lookup uses TMDB ID; TV lookup resolves TheTVDB ID through TMDB external IDs.
- Wikimedia Commons - official MediaWiki API; no secret required; license / attribution metadata is preserved.
- TVmaze - public fallback poster source.

External/reference-only sources are returned to the client as links: Kinorium, CineMaterial, MovieStillsDB, ShotDeck, The Poster Database, IMDb and IMP Awards.

The image proxy only accepts HTTPS from an explicit hostname allowlist, rejects IP / localhost targets, validates MIME type, limits responses to 25 MB, follows only allowlisted redirects, times out after 12 seconds and caches validated image responses.
