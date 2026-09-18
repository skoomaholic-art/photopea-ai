# Canvas engine decision

## Decision
Use **Fabric.js 7.4.0** as the primary scene/object engine for Skooma Studio.

## Why Fabric over Konva for this project
Both projects are mature and MIT licensed. Konva is excellent for interactive graphics and has a strong scene graph, events, transforms and export. Fabric was selected because Skooma Multitool is closer to an image/design editor than a diagramming surface and Fabric already bundles several features we need together:

- move / scale / rotate / skew controls;
- groups;
- editable text;
- images;
- shapes;
- brushes;
- image filters;
- JSON serialization;
- SVG import/export;
- PNG / JPG export.

This lets the project delete its hand-written object selection and transform geometry instead of maintaining a second custom scene graph.

## Raster plan
Fabric is the object/document engine, not the final answer for Photoshop-like raster tooling.

For raster-specific tools we will:
1. inspect miniPaint's MIT-licensed implementations and architecture;
2. reuse or adapt only code that is clearly compatible and valuable;
3. keep attribution / license notices for any copied source;
4. move expensive pixel operations into workers where useful.

## Vector plan
Use Fabric's SVG and object primitives first. Study SVG-Edit for path/node editing. Reuse code only after a file-by-file license review.

## Explicitly not chosen
- Konva: retained as a reference / fallback, not loaded together with Fabric.
- tldraw SDK: not used because production deployment requires a suitable license key.
- Penpot source: not copied because MPL-2.0 reuse should be intentional and isolated.
