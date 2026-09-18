# Skooma Multitool

Единое браузерное рабочее пространство для графики, AI-генерации и поиска медиаматериалов.

## Что уже есть

- **Studio** - собственный canvas-редактор без зависимости от Photopea:
  - слои;
  - импорт изображений;
  - текстовые слои;
  - кисть;
  - перемещение;
  - порядок и видимость слоёв;
  - opacity;
  - изменение размера документа;
  - undo / redo;
  - PNG export;
  - AI-генерация через Puter как новый слой.
- **AI** - проверенные в текущем проекте GPT Image 1 Mini и Grok Imagine.
- **Photopea** - отдельная вкладка редактора.
- **Vectorpea** - отдельная вкладка векторного редактора.
- **Jampea** - отдельная вкладка MIDI / музыкального редактора.
- **Perchance** - отдельная вкладка text-to-image plugin.
- **Media Finder**:
  - TMDB movie search;
  - TMDB posters, backdrops and logos;
  - fanart.tv artwork by TMDB ID;
  - Kinorium search and public-page reading through Jina Reader;
  - добавление найденного изображения прямо в Studio.

## API и ключи

Ключи не хранятся в репозитории. Они вводятся в разделе **Настройки** и сохраняются в localStorage браузера.

- TMDB - API Read Access Token.
- fanart.tv - Project или Personal API key.
- Jina Reader - ключ необязателен для базовых запросов, но может понадобиться для больших лимитов.

## Почему Kinorium сделан иначе

Публичный официальный Kinorium API в ходе проверки не найден. Поэтому мультитул не выдаёт scraping за официальный API. Для открытых страниц используется Jina Reader, а поиск ограничивается доменами Kinorium.

## Структура

- `index.html` - shell мультитула.
- `styles.css` - единый интерфейс.
- `app.js` - вкладки, настройки и общая логика.
- `studio.js` - собственный редактор.
- `media.js` - TMDB, fanart.tv, Kinorium/Jina.

## GitHub Pages

Проект публикуется GitHub Actions workflow из ветки `main`.

Сайт:

https://skoomaholic-art.github.io/photopea-ai/

## Следующие этапы

PSD/SVG-парсинг, маски, blend modes, crop/selection, нормальная трансформация с handles, smart-object-подобные слои, backend для секретов, Perchance bridge через собственный Perchance generator и postMessage.
