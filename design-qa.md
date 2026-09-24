# Poster Markup — Design QA

## Result

`blocked`

The implementation was updated against the supplied Poster Markup reference: the existing dark green three-column language is retained, while the requested poster search, independent format controls, local background removal, comparison panel, three download actions, server-status copy, and Godfather-style icon are now present in the source.

## Static evidence

- `npm run smoke` — passed.
- `node --check poster-app.js` — passed.
- `node --check scripts/dev-server.mjs` — passed.
- `git diff --check` — passed.
- Local `/api/config` — returned a safe capability object without exposing secrets.
- Local `/api/posters` without a TMDB key — returned an explicit setup message and HTTP 503.

## Required browser verification still blocked

Cloud browser refresh and the local Playwright command were denied by the environment's automatic approval usage limit. Therefore this report does not claim that the new interactions, pixel layout, exports, ZIP contents, or Photopea transfer were re-verified after the latest changes.

The next QA pass must exercise:

- vertical/horizontal state isolation after repeated switching;
- exact PNG dimensions and ZIP entries;
- poster search result selection;
- local background-removal model load and transparency;
- Grok/GPT error recovery and source/result comparison;
- Photopea transfer and layer order;
- desktop and mobile overflow.
