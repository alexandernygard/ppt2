# ppt2

An experiment: PowerPoint rebuilt around code, with an AI co-author. Decks are TSX modules.
You can edit them visually, in code, or by asking Claude, and all three change the same source.

```bash
pnpm install
pnpm dev        # http://localhost:5291
pnpm test       # SDK tests (compiler + source patches)
```

Add your Anthropic API key under the gear icon. Everything runs in the browser; there is no server.

## Packages

| Package | What it is |
|---|---|
| `packages/sdk` (`@ppt2/sdk`) | The deck language: components (`Deck`, `Slide`, `Title`, `Text`, `List`, `Image`, `Shape`, `Chart`, `Table`, `Code`, `Stat`, `Quote`, `Row`, `Column`, `Card`, `Notes`), `csv` helper, themes, layouts, the compiler (source → model), **source patches** (model edits → minimal text edits), outline/lint, and `REFERENCE`, an LLM-readable spec of the language. No React. |
| `packages/react` (`@ppt2/react`) | Rendering: `SlideView` (native 1920×1080), `Stage` (scales any fixed canvas to any box), `EditableSlide` (select, drag, resize, snap, inline text), `Presenter` (builds, transitions, speaker view), `inspectSlideElement` (rendered overflow checks), `exportPptx`. Uses @alexandernygard/components (Chart, CodeBlock, Table). |
| `apps/web` | The editor: Vite + React + Tailwind 4 + zustand + CodeMirror + Claude API. |

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
- **No multi-select, grouping, z-order controls, or alignment tools** beyond snapping. No image upload (URLs only; placeholders come from picsum.photos). Undo is source-level, with typing coalesced into one step per pause.
- **The AI loop was tested against a scripted mock of the streaming API, not the live model** (no key was available while building). Live behavior, such as how well it follows the style guide, still needs a real run.
- **Performance.** Every edit recompiles and re-renders all thumbnails plus the offscreen render farm. That's fine for dozens of slides, and would need memoizing by slide source range for hundreds.

## What would make this a "new form factor"

- A **sandboxed runtime and a stable file format** (`.deck.tsx` plus assets), so decks can be shared, diffed and rendered on a server (headless PDF/PNG for previews, CI checks that lint a deck the way we lint code).
- **Constraint-based pinning** ("12px below the title") instead of raw x/y, so moved elements survive layout and theme changes.
- **Live data bindings**: charts pointing at a CSV/URL that refresh when presented.
- **Semantic diffing and review**: show "slide 3: title changed, chart type bar → line" rather than a text diff.
