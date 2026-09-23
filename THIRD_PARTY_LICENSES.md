# Third-party software and services

This file tracks runtime libraries and external APIs used by Poster Editor.

## Fabric.js

- Repository: https://github.com/fabricjs/fabric.js
- License: MIT
- Version: 7.4.0
- Use: interactive object canvas for the «Паровозик» workspace.
- Loaded from jsDelivr; Fabric source code is not copied into this repository.

## Playwright

- Repository: https://github.com/microsoft/playwright
- License: Apache-2.0
- Use: CI browser testing only.

## TVmaze

- API: https://www.tvmaze.com/api
- Public API license: CC BY-SA.
- Free public rate: 20 calls per 10 seconds per IP.
- Use: title search and poster artwork.
- Attribution is shown in the application.

## TMDB

- API: https://developer.themoviedb.org/
- API use must follow TMDB's current terms and attribution requirements.
- The Worker only requires a configured server-side TMDB credential; it no longer uses a custom UI-blocking approval flag.

## Carve.Photos

- Website: https://carve.photos/
- API base: https://api.carve.photos/api/v1
- Official SDK: https://github.com/Carve-Photos/sdk-node
- Use: optional server-side background removal.
- Requires CARVE_API_KEY.

## Removal.AI

- API docs: https://removal.ai/api-documentation/
- Endpoint used: POST https://api.removal.ai/3.0/remove
- Use: optional server-side background removal.
- Requires REMOVAL_AI_KEY.

## Cloudflare Workers AI

- Docs: https://developers.cloudflare.com/workers-ai/
- Model: @cf/black-forest-labs/flux-2-klein-4b
- Use: primary server-side logo image editing provider through the Worker AI binding.
- Cloudflare provides a shared daily free allocation; usage above it follows the account plan.

## OpenRouter

- API docs: https://openrouter.ai/docs/
- Models: x-ai/grok-imagine-image-2.0 and openai/gpt-image-1.
- Use: optional paid fallback image editing providers.
- Requires OPENROUTER_API_KEY stored only on the Worker.

## IMG.LY background-removal

- Package: @imgly/background-removal 1.7.0
- Repository: https://github.com/imgly/background-removal-js
- License: AGPL (see upstream license for obligations).
- Use: browser-side background removal fallback with cached ONNX/WASM model assets.
- Loaded on demand from jsDelivr; model/runtime assets are fetched and cached by the browser.

## Photopea

- Website: https://www.photopea.com/
- Use: external editor loaded in a dedicated iframe workspace.
- No Photopea source code is copied into this repository.
