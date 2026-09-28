# Poster Editor - Design QA

## Result

`passed`

The checked scope is the TOP10 number picker, the TOP10 canvas number layer, and the white-on-black application mark requested on 28 September 2026.

## Visual truth and evidence

- Source strip 1-5: `/workspace/scratch/1c3b11c49cc1/upload/2026-09-23_13-53-32.png`, 1800 × 151.
- Source strip 6-10: `/workspace/scratch/1c3b11c49cc1/upload/2026-09-23_13-53-40(1).png`, 1845 × 193.
- White logo request: `/workspace/scratch/1c3b11c49cc1/upload/image(20260928-105230).png`, 285 × 75.
- Full browser capture with the picker open: `/workspace/scratch/top10-picker-browser-20260928-v2.png`, 1348 × 926.
- Browser capture after selecting position 10: `/workspace/scratch/top10-number-10-browser-20260928.png`, 1348 × 926.
- Pixel extraction proof: `docs/top10-reference-comparison.png`.

Browser viewport: 1363 × 936, device pixel ratio 1. State: TOP10 workspace, number 2 with picker open, followed by number 10 selected with picker closed.

## Comparison history

1. First pass used five picker columns. The menu extended beyond the left sidebar and clipped part of the catalog.
2. The picker was changed to a full-width, two-column, vertically scrollable catalog.
3. Second pass confirmed that the menu remains inside the sidebar, all ten options are reachable, the selected option is highlighted, and the preview uses the exact source-derived PNG.
4. Position 10 was selected in the live browser. The hidden state value became `10`, the picker label became `Позиция 10`, and the TOP10 canvas updated to the matching number asset.

## Visual findings

- Typography: labels and controls follow the existing Poster Editor type scale. No new font dependency was added.
- Spacing: the picker aligns with the existing left control column and does not cover the canvas or right sidebar.
- Color: source green-to-blue stroke pixels are preserved. The black glyph body and transparent outer area match the requested treatment.
- Image quality: native picker previews use source-size cutouts. Canvas and export use padded 500 × 500 RGBA assets, avoiding CSS stretching and aspect distortion.
- Icon: the existing artwork geometry was retained. Its red foreground was changed to white while the black background remained black.
- Copy: picker labels use `Позиция 1` through `Позиция 10` and the existing Russian interface language.

## Interaction and console checks

- Open and close picker: passed.
- Select position 10: passed.
- State, preview, and canvas synchronization: passed.
- Keyboard navigation matches the two-column layout: passed, with left/right by one item and up/down by two items.
- Application console errors on `http://terminal.local:4173`: none.
- Browser extension metadata errors were present only under `chrome-extension://` and are not application errors.

## Automated checks

- `npm run test:unit`: 43 passed, 0 failed. This includes 10 per-number pixel tests and a white-on-black icon test.
- `npm run check:syntax`: passed for 47 files.
- `npm run smoke`: passed.
- `npm run build:static`: passed with 65 allowlisted files.
- `git diff --check`: passed before the final documentation update and must be repeated before commit.
- Local Playwright suite could not start because its Chromium executable is absent from the environment. The relevant interaction was instead exercised in the connected Chrome browser and is not reported as a Playwright pass.

## Remaining severity items

- P0: none.
- P1: none in the checked scope.
- P2: none in the checked scope.
