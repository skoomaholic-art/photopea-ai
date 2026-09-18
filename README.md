# Photopea AI Bridge

Статический веб-инструмент для генерации изображений через Puter.js и передачи результата прямо в Photopea.

## Что умеет

- генерация изображения по промпту через `puter.ai.txt2img()`
- опциональный референс для image-to-image
- выбор модели, формата и качества
- тестовый режим Puter
- предпросмотр результата
- скачивание PNG
- отправка результата или референса в Photopea через `postMessage()`
- встроенный Photopea в iframe
- не требует собственного API-ключа Puter

## Важно про "бесплатно"

GitHub Pages только хостит интерфейс и сам изображения не генерирует. Генерацию выполняет Puter.js. Puter использует модель User-Pays: собственный API-ключ разработчика не нужен, но реальная генерация может зависеть от лимитов, кредитов и правил аккаунта Puter. Для бесплатной проверки есть переключатель тестового режима.

Документация Puter:
https://docs.puter.com/AI/txt2img/

Документация Photopea Live API:
https://www.photopea.com/api/live

## GitHub Pages

В репозитории открой:

`Settings -> Pages -> Build and deployment -> Source -> Deploy from a branch`

Выбери:

- Branch: `main`
- Folder: `/ (root)`

После сохранения сайт будет доступен примерно по адресу:

`https://skoomaholic-art.github.io/photopea-ai/`
