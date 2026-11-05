# DevHub App Icon Generation

## Why replace it

The current mark is a pair of white refresh arrows on a purple gradient. It reads as a generic refresh action and does not distinguish DevHub's role as a hub for syncing extensions between code editors.

## GPT Image prompt

Create a polished, production-ready application icon for **DevHub**, a Windows desktop utility for syncing extensions between VS Code-family editors and managing developer tools.

Design one compact, bold geometric symbol: two small generic editor-window panels connected through a central hub, with one simple extension tile visibly moving or being shared between them. Make the connection and exchange legible at a glance. Keep the mark symmetrical and tightly composed, with a strong silhouette that remains recognizable at 32 x 32 pixels. Use simplified window shapes, not detailed UI.

Use a full-bleed square background in deep graphite (`#20282B`). Build the symbol from a restrained, balanced palette of vivid mint (`#55E2B2`), warm coral (`#FF765F`), and a small amount of soft white. Use crisp edges, subtle depth only where it improves separation, and strong contrast. The overall feel should be precise, modern, dependable, and appropriate for a developer desktop tool.

Output a single 1024 x 1024 square icon image, centered and optically balanced. Make the artwork itself fill the square canvas; do not draw a rounded-square mask, device mockup, border, or presentation scene. Keep all important shapes comfortably inside the canvas so they survive small-size rendering and Windows icon cropping.

Do not include any text, letters, numbers, code, logos, brand marks, or recognizable editor icons. Do not use the VS Code logo or imitate any editor's branding. Avoid refresh/reload arrows, cloud symbols, gear symbols, generic sync-loop arrows, gradients, glow, busy circuitry, tiny UI details, and extra decorative elements.

## Review checklist

- The first impression is editor extensions being shared through one central developer hub, not a generic refresh button.
- The silhouette remains clear when reduced to 32 x 32 pixels and still reads at 16 x 16.
- The two accent colors remain distinct against the graphite background.
- There is no text, trademarked editor symbol, mockup, or pre-rounded canvas.
- The image is exactly square and at least 1024 x 1024 pixels.

## Project integration

Keep the selected source image at `devhub-icons/devhub-icon.png`. Once the artwork is approved, regenerate Tauri's bundled platform icons from the project root:

```powershell
pnpm exec tauri icon devhub-icons/devhub-icon.png -o src-tauri/icons
```

The web favicon is separately referenced from `public/favicon.svg` by `index.html`; update it to match the approved mark as a separate step. Review the generated assets in Explorer and at small sizes before building a release.
