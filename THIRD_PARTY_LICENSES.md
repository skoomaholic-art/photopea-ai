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
- Free API use is for non-commercial purposes with attribution.
- Commercial usage requires an appropriate commercial license.
- The Worker keeps TMDB disabled unless both a server token and TMDB_COMMERCIAL_APPROVED=true are configured.

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

## OpenAI

- API docs: https://developers.openai.com/
- Model: gpt-image-1-mini
- Use: optional server-side logo image edit.
- Requires OPENAI_API_KEY.

## xAI / SpaceXAI

- API docs: https://docs.x.ai/
- Model: grok-imagine-image-2.0
- Use: optional server-side logo image edit.
- Requires XAI_API_KEY.

## Photopea

- Website: https://www.photopea.com/
- Use: external editor loaded in a dedicated iframe workspace.
- No Photopea source code is copied into this repository.
