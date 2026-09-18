# Skooma Multitool

Единое браузерное creative workspace для графики, AI и медиаматериалов.

## Текущая архитектура

Skooma Multitool больше не использует модель "несколько отдельных страниц".

Главный shell остаётся на месте, а центральная рабочая область переключает редактор:

- Skooma Studio
- Photopea
- Vectorpea
- Jampea fallback

AI, Media Finder и Assets открываются как инструменты внутри общего приложения.

## Skooma Studio

Основной редактор переведён с самописного canvas engine на Fabric.js 7.4.0.

Работает:

- object selection;
- transform handles;
- resize;
- rotate;
- image layers;
- editable text;
- rectangle / ellipse;
- brush;
- eraser strokes;
- layer visibility;
- layer locking;
- drag reorder;
- duplicate / delete;
- object properties;
- PNG / JPG / WEBP export;
- PNG / JPG / JPEG / WEBP import;
- SVG import;
- drag & drop;
- paste image from clipboard;
- Ctrl+C / Ctrl+X / Ctrl+V for objects;
- Ctrl+D;
- Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y;
- Space temporary Hand;
- IndexedDB autosave;
- restore autosave after reload.

## AI

AI является инструментом Studio, а не отдельной страницей.

Проверенные модели:

- GPT Image 1 Mini
- Grok Imagine

Результат генерации:

AI -> Asset Library -> новый image layer.

Perchance не встраивается сломанным iframe. Он показывается как внешний provider с нормальным fallback.

## Media Finder

Media Finder находится внутри общего shell.

Provider architecture:

- TVmaze - работает без ключа;
- OMDb - включается при наличии API key;
- TMDB - включается при наличии Read Access Token;
- fanart.tv - дополнительный artwork provider для TMDB movie results.

Kinorium / Jina удалены из критической цепочки.

Найденный poster / artwork можно добавить в Studio.

## Assets

Общая Asset Library хранит:

- uploads;
- AI generated images;
- media artwork.

Assets сохраняются через IndexedDB.

## External editors

Photopea и Vectorpea могут открываться в центральной workspace area.

Jampea по результатам тестирования не считается надёжно embeddable, поэтому вместо белого / пустого iframe показывается native fallback с кнопкой открытия сервиса отдельно.

## Licensing

См. [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

Canvas engine decision:

[docs/CANVAS_ENGINE_DECISION.md](docs/CANVAS_ENGINE_DECISION.md)

## Deployment

GitHub Pages deploy выполняется через GitHub Actions.

Перед каждым deploy выполняется:

`node scripts/static-smoke.mjs`

Smoke check проверяет:

- обязательные файлы;
- JavaScript syntax;
- duplicate DOM ids;
- JavaScript references to missing DOM ids;
- local script references from index.html.

Сайт:

https://skoomaholic-art.github.io/photopea-ai/

## Следующие этапы

1. Crop / marquee / lasso / magic wand.
2. Proper raster eraser and raster masks based on reviewed miniPaint MIT implementations.
3. Blend modes / merge / flatten / groups.
4. Better zoom / pan / guides / snapping.
5. Asset categories and media details UX.
6. OMDb / TMDB provider polish and caching.
7. Wikidata fallback.
8. SVG path/node editing based on reviewed SVG-Edit architecture.
9. Project JSON import/export.
10. Performance profiling on large images.
