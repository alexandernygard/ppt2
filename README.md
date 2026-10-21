# ppt2

An experiment: PowerPoint rebuilt around code, with an AI co-author. Decks are TSX modules.
You can edit them visually, in code, or by asking Claude, and all three change the same source.

```bash
pnpm install
pnpm dev        # http://localhost:5291
pnpm test       # SDK tests (compiler + source patches)
```

Add your Anthropic API key under the gear icon. Decks live in your browser; the only server code is the optional live-collaboration Worker (below).

### Sharing a deck live

Share in the top bar needs a Nyggis account: it saves the deck to Drive, where you add people by email and choose who can edit, and you edit together, seeing which slide each person is on and what they have selected. Undo is per person while a deck is shared. Decks shared by link before Drive still sync through this app's Durable Object (`apps/worker`, built on `@alexandernygard/collab`; assets over 900 KB stay local) until they're saved to Drive or the link is turned off. A new tab starts on an empty deck; a reload keeps the deck you were in, and earlier decks stay in the library.

```bash
pnpm dev:worker   # Worker + Durable Object on :8788 (vite proxies /collab to it)
pnpm dev          # the app
```

### Drive

Decks in [Drive](../drive) (drive.nyggis.com) open here as `/?file=<id>` and sync through the drive's rooms instead of this app's Worker, so sharing follows Drive: people you add by email, as viewers or editors, with Nyggis accounts. The header shows who else is in the file and Drive's share dialog. *Save to Drive* (in Share) moves a local deck there. Locally, run the drive (`pnpm dev:worker` in `../drive`) and the auth Worker (:8787).

## Packages

| Package | What it is |
|---|---|
| `packages/sdk` (`@ppt2/sdk`) | The deck language: components (`Deck`, `Slide`, `Title`, `Text`, `List`, `Image`, `Icon`, `Shape`, `Chart`, `Table`, `Code`, `Stat`, `Quote`, `Row`, `Column`, `Card`, `Notes`, and the diagrams `Flow`, `Tree`, `Timeline`, `Cycle` with `Step`/`Node`), `csv` helper, themes, layouts, the compiler (source → model), **source patches** (model edits → minimal text edits), outline/lint, and `REFERENCE`, an LLM-readable spec of the language. No React. |
| `packages/react` (`@ppt2/react`) | Rendering: `SlideView` (native 1920×1080), `Stage` (scales any fixed canvas to any box), `EditableSlide` (select, drag, resize, snap, inline text), `Presenter` (builds, transitions, speaker view), `inspectSlideElement` (rendered overflow checks), `exportPptx`, diagram layout (dagre for flows, a tidy-tree layout for org charts), Lucide icons, image crop. Uses @alexandernygard/components (Chart, CodeBlock, Table). |
| `apps/web` | The editor: Vite + React + Tailwind 4 + zustand + CodeMirror + Claude API, plus the deck library (IndexedDB) and disk sync. |

```tsx
import { Deck, Slide, Title, Chart, Notes, csv } from "ppt2"

const growth = csv`
quarter,revenue
Q1,1.2
Q2,1.8
`

export default (
  <Deck title="Q3" theme="midnight">
    <Slide layout="content" transition="fade">
      <Title>Revenue is outrunning costs</Title>
      <Chart type="bar" data={growth} category="quarter" series="revenue" />
      <Notes>Costs grew 66% while revenue almost tripled.</Notes>
    </Slide>
  </Deck>
)
```

## How the round trip works

**The source string is the only source of truth.** Nothing else is saved; the model is always derived from the code.

1. **Compile.** Babel parses the TSX. Every JSX element gets an injected `__src={offset}`, so each node in the compiled model knows exactly where it came from. Sucrase transpiles the code and it runs against the ppt2 runtime. Real code works: variables, `.map`, helper components, `csv` data.
2. **Visual edit → patch.** Dragging, typing, reordering or changing the theme never re-prints the file. Each becomes a surgical text edit at the element's offset (`setProps`, `setText`, `moveSlide`, `insertElement`, ...; see `packages/sdk/src/patch.ts`). Comments, formatting and untouched code stay byte-identical, which the tests assert.
3. **Computed values are protected.** If a prop is an expression (`items={items}`) or the text comes from code (`{t.name}`), the patch is refused with an explanation, rather than replacing your logic with a literal. Elements inside a `.map` or a component are flagged as *templates*: an edit there applies to every copy, and the UI says so.
4. **Code edit → canvas.** Typing recompiles on every keystroke. When the code doesn't compile, the canvas keeps the last good version and the error shows under the editor.
5. **Selection syncs both ways.** Clicking an element highlights its code; moving the cursor in code selects the element on the canvas. External changes flash in the editor so you can see what a drag did.

## Layout: declarative first, absolute when you mean it

Slides pick a **layout** (`title`, `content`, `two-column`, `image-left/right`, `grid`, `statement`, `quote`, `section`, `full-image`, `blank`). Children fill its slots automatically (first `Title` → title slot, first `Image` → media slot), or explicitly with `slot="left"`. That keeps the code short and readable, which is what AI-written decks need: the model says *what* goes on a slide, not *where*.

Dragging an element **pins** it: it gains `x/y/w` and leaves the flow, and the other elements reflow live while you drag. "Return to layout" removes the coordinates again. Flow is the default and pinning is a visible, reversible decision in the code, instead of every element silently getting absolute coordinates the way it does in PowerPoint.

## What "AI first" means here

- **Code is the AI's native medium.** Claude edits the same TSX you do, using `edit_deck` (exact find/replace, which keeps your manual tweaks intact) or `write_deck` (whole file, streamed: slides appear on the canvas while it writes).
- **It checks its work.** Each tool result reports compile errors, density lint and *rendered* layout problems (overflowing slots, text too long for its box). `inspect_deck` returns slide screenshots so the model can see the result.
- **Options, not one answer.** `propose_variants` renders 2–3 alternatives for a slide as live previews in the chat, and you pick one.
- **It works on the spec.** The SDK ships `REFERENCE`, a spec of the language written for LLMs, and the system prompt is built from it. Every turn includes the current source, the slide you're looking at and the selected element's code.
- **Context-aware actions:** tighten, suggest layouts, make it visual, speaker notes, restyle, review. You can paste or attach CSV to turn data into a chart.
- **Every AI edit is undoable**, and each one is a reviewable diff of the source.

## Decks, files and images

- **Library.** Any number of decks live in IndexedDB and save as you type. Click the deck title to switch, duplicate or delete.
- **Version history.** A snapshot every 10 minutes of editing, before every AI edit and before a restore, plus versions you name. File → Version history previews any snapshot slide by slide; restoring is undoable.
- **Files on disk** (Chromium browsers, File System Access API). *Save as folder* writes `deck.tsx` plus an `assets/` folder; *Save as file* writes a single `.deck.tsx`. Once linked, edits save to disk, and changes made on disk (an editor, `git pull`, Claude Code) load into the open deck within a couple of seconds. After a reload the browser asks for permission again ("Reconnect").
- **Images.** Paste, drop onto the slide (or onto an image to replace it) or upload from Insert. They're stored with the deck and referenced as `src="assets/photo.jpg"`, so the source stays portable. Large photos are downscaled to 3200px. Double-click an image (or use Crop) to reposition and zoom it inside its frame; that writes `focus="30% 60%"` and `zoom={1.4}`.
- **Icons.** `<Icon name="rocket" />` with the full Lucide set and a searchable picker.
- **Diagrams.** `<Flow>`, `<Tree>`, `<Timeline>` and `<Cycle>` describe steps and connections; layout is automatic and scales to fit its slot. Node labels are editable inline on the canvas, and PPTX export turns nodes into native shapes with the connectors as one vector image.

```tsx
<Flow>
  <Step icon="pencil">Draft</Step>
  <Step id="review">Review</Step>
  <Step kind="diamond" to="ship:Yes fix:No">Tests pass?</Step>
  <Step id="ship" to="">Ship</Step>
  <Step id="fix" to="review">Fix</Step>
</Flow>
```

## Present, export

- **Present**: fullscreen, arrows/space/PageUp/Down, `S` speaker view (current, next, notes, timer, build counter), `B` black screen, `Esc` to exit. Builds use `step={n}` and `animate="rise"`; slide transitions use `transition="fade"`. In speaker view, "Open audience window" opens a second window that stays in sync over BroadcastChannel.
- **PDF**: File → PDF prints an offscreen render of every slide, one per page (`@page` set to 1920×1080).
- **PPTX**: *render, then measure*. The browser lays out each slide, each element's box and computed style is measured, and the result maps to native PowerPoint objects. Charts become native, editable PowerPoint charts, and notes are included.
- **Source**: download or open `.deck.tsx` files. The deck is plain code, so it works with git and code review.

## Limitations and open questions

- **Executing code.** Deck code runs with `new Function` in the page. That's fine for your own decks, but it's not a sandbox: an untrusted deck, or a hostile prompt injected into the AI, could run arbitrary JS. The real fix is to compile and run in a sandboxed iframe or Worker (the compiler has no DOM dependency, so this is mostly plumbing).
- **API key in the browser.** It's stored in localStorage and sent directly with `dangerouslyAllowBrowser`. That's acceptable for a personal tool, not for a shared product, which needs a small proxy.
- **Round-trip edges.** Visual edits can't change computed values, and a dragged element in a component has no single place to write its position. That's by design, but it means some decks are "code-only" in places. A future option would be per-instance overrides written next to the call site.
- **Rich text is markdown-lite** (bold, italic, code, highlight, links, bullets). Per-character styling, like coloring one word, needs either more inline syntax or a real rich-text node type. Inline editing uses a raw-text overlay, not WYSIWYG.
- **Layout engine = CSS.** Exact layout depends on browser fonts. PPTX export measures the browser's layout, so it's faithful to what you saw, but text in PowerPoint reflows with PowerPoint's own font metrics. Gradients/backdrops and Markdown inline styles aren't carried into PPTX, and PPTX import isn't implemented. A deterministic, font-metric-aware layout engine (e.g. Yoga plus measured text) would make export and server-side rendering exact.
- **No multi-select, grouping, z-order controls, or alignment tools** beyond snapping.
- **Files and assets.** Disk sync needs the File System Access API (Chrome, Edge, Arc); elsewhere decks stay in the browser and can be imported or downloaded. Fonts aren't stored with a deck yet. Deck thumbnails in the library only show images for the open deck. Deleting an image from a slide leaves the asset stored with the deck. The bundle is ~3.8 MB because every Lucide icon is included so any name the AI writes works.
- **Diagram layout is estimated**, not measured: node sizes come from label length, so very long labels can crowd a node. Big diagrams shrink to fit (the AI gets a warning when text drops below 60%). Undo is source-level, with typing coalesced into one step per pause.
- **The AI loop was tested against a scripted mock of the streaming API, not the live model** (no key was available while building). Live behavior, such as how well it follows the style guide, still needs a real run.
- **Performance.** Every edit recompiles and re-renders all thumbnails plus the offscreen render farm. That's fine for dozens of slides, and would need memoizing by slide source range for hundreds.

## What would make this a "new form factor"

- A **sandboxed runtime and a stable file format** (`.deck.tsx` plus assets), so decks can be shared, diffed and rendered on a server (headless PDF/PNG for previews, CI checks that lint a deck the way we lint code).
- **Constraint-based pinning** ("12px below the title") instead of raw x/y, so moved elements survive layout and theme changes.
- **Live data bindings**: charts pointing at a CSV/URL that refresh when presented.
- **Semantic diffing and review**: show "slide 3: title changed, chart type bar → line" rather than a text diff.
