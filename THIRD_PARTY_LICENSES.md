# Third-party libraries and references

This file tracks third-party software used by Skooma Multitool and projects consulted as references.

## Runtime dependency

### Fabric.js
- Repository: https://github.com/fabricjs/fabric.js
- License: MIT
- Version pinned in the app: 7.4.0
- Use: interactive canvas/object model, selection, transform controls, text, shapes, free drawing, serialization and export.
- Integration: loaded from jsDelivr. No Fabric source code is copied into this repository.

## Raster implementation reference

### miniPaint
- Repository: https://github.com/viliusle/miniPaint
- License: MIT
- Use: reference for raster editor architecture and future brush / fill / magic-wand / filter work.
- Current status: no miniPaint source code copied into this repository.

## Vector implementation reference

### SVG-Edit
- Repository: https://github.com/SVG-Edit/svgedit
- Primary project license: MIT
- Use: reference for SVG editing architecture and future path/node tooling.
- Important: SVG-Edit ships some bundled files under additional licenses. Any future code reuse must be reviewed file-by-file before copying.
- Current status: no SVG-Edit source code copied into this repository.

## UX / architecture references only

### Excalidraw
- Repository: https://github.com/excalidraw/excalidraw
- License: MIT
- Use: tool switching, shortcuts, selection and interaction references.
- No code copied.

### Penpot
- Repository: https://github.com/penpot/penpot
- License: MPL-2.0
- Use: UX and application architecture reference only.
- No code copied.

### tldraw
- Website: https://tldraw.dev/
- Use: interaction reference only.
- The production SDK requires an appropriate license key.
- Not included as a dependency.

### Jellyfin Web / Radarr / Sonarr
- Use: media-browser UX references only.
- No GPL application code copied.

## External services

### Puter.js
- Website: https://puter.com/
- Use: browser-side AI image generation and Puter authentication.
- Models exposed by this project are limited to the models verified in the current application.

### TVmaze
- API: https://www.tvmaze.com/api
- Use: free TV metadata/search provider.

### TMDB
- API: https://developer.themoviedb.org/
- Use: optional movie / TV metadata and artwork provider when a token is configured.
- Required attribution is shown in the application.

### OMDb
- API: https://www.omdbapi.com/
- Use: optional movie / series / episode metadata provider when an API key is configured.

### fanart.tv
- API: https://fanart.tv/api-docs/
- Use: optional artwork provider when an API key is configured.

No proprietary Photopea, Vectorpea or Jampea source code is included in this repository.
