# Scrollable review and agent-created Image Occlusion

The review component now reserves a viewport for card content and keeps the header and grading controls visible. ↑/↓ scroll one row, PageUp/PageDown scroll a page, Home/End jump to the beginning/end. Wheel events are handled through pi-tui's mouse dispatch and SGR input; tmux must pass mouse events (this user's configuration defaults mouse off). Browse navigation still uses j/k. A new card resets scrolling; revealing a normal card moves to its answer section.

`anki_add_note` accepts `occlusion: {image, masks, hideOthers}` and selects the existing native `Image Occlusion` note type automatically. Agents inspect an image, then supply rectangular regions in 0–1 coordinates. Each region creates a card by default; shared `group` numbers combine regions into one retrieval target. `hideOthers` defaults to true. The normal preview and confirmation flow is retained. Invalid/out-of-bounds masks are rejected before importing media; local/URL imports must succeed. Header and Back Extra come from front/back or named fields. The agent authoring skill and tool guidelines now route image-region questions to this template.

Review composites the native rendered `data-shape` masks into PNG using sharp, including rectangles, ellipses, polygons and rotation. `.cloze` is opaque on the question; `.cloze-highlight` outlines/reveals the answer; other masks are kept only when `data-occludeInactive=1`. The answer replaces the masked question image. Missing/unsupported native mask data shows a placeholder instead of an unmasked question. Arbitrary third-party JavaScript templates and text-shaped annotations are not implemented.

Sources consulted for the native format: [Anki rendered shapes](https://github.com/ankitects/anki/blob/main/ts/routes/image-occlusion/shapes/from-cloze.ts), [Anki reviewer](https://github.com/ankitects/anki/blob/main/ts/routes/image-occlusion/review.ts), [sharp compositing](https://sharp.pixelplumbing.com/api-composite/). Implementation reads the rendered classes/data attributes and does not execute card scripts.

## Verification on mini-t

- Typecheck and full suite pass locally and remotely: **55 pass / 1 existing live-test skip**.
- Agent tool integration tests cover confirmed creation, generated groups/fields, cancellation without writes and coordinate validation before media writes.
- Pixel tests verify the front actually masks its target, the back reveals it, and inactive masks follow hideOthers.
- Actual AnkiConnect verification ran the authoring pipeline against mini-t's existing Image Occlusion model and existing image. A temporary note produced **two native cards with ordinals 0 and 1**. Both rendered front/back HTML contained the expected native shape data and successfully composited. The temporary note was deleted in a finally block; original notes were not modified or graded.
- The captured HTML from that actual Anki note was replayed with the real FlashcardComponent/pi-tui through Ghostty → SSH mini-t → tmux, using an isolated three-pane test session. [Masked front](assets/2026-10-14-occlusion/front.png), [PageDown scroll](assets/2026-10-14-occlusion/scrolled.png), [revealed target with other mask retained](assets/2026-10-14-occlusion/back.png). Header/footer remain visible and images stay in the review pane.
- `sharp` is a runtime dependency and was installed on mini-t. Existing Pi processes need `/reload` to load the updated tools/skill/extension.
