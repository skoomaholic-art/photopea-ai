# Poster Editor Worker

Cloudflare Worker keeps all provider credentials on the server side.

## Endpoints

- GET /api/status
- GET /api/posters?q=...
- GET /api/image?url=...
- POST /api/generate
- POST /api/remove-background

## Secrets

Configure only the providers you intend to use:

    npx wrangler secret put XAI_API_KEY
    npx wrangler secret put OPENAI_API_KEY
    npx wrangler secret put CARVE_API_KEY
    npx wrangler secret put REMOVAL_AI_KEY
    npx wrangler secret put TMDB_BEARER_TOKEN

TMDB remains disabled unless wrangler.toml has TMDB_COMMERCIAL_APPROVED = "true". Do not set it to true unless the deployment has a license that permits its commercial use.

Deploy with:

    npx wrangler deploy

The browser receives only availability booleans and API results. Provider secrets are never serialized to the client.
