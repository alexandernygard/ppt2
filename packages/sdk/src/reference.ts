// LLM-facing reference for the ppt2 language. The SDK ships its own spec so
// any model (or human) can write decks without guessing.

import { layouts } from "./layouts"
import { themes } from "./themes"

export const REFERENCE = `# ppt2 deck language

A deck is a TSX module that default-exports a <Deck>. Everything is declarative JSX; plain
TypeScript (variables, arrays, .map, helper components) is allowed for data and repetition.

\`\`\`tsx
import { Deck, Slide, Title, Subtitle, Text, List, Image, Chart, Stat, Notes } from "ppt2"

export default (
  <Deck title="Q3 Review" theme="midnight">
    <Slide layout="title">
      <Title>Q3 Review</Title>
      <Subtitle>Growth, product and what's next</Subtitle>
      <Notes>Welcome everyone. Keep this under a minute.</Notes>
    </Slide>
  </Deck>
)
\`\`\`

## Coordinate system
Slides are 1920×1080 units (16:9). Height is always 1080; width follows aspect ("16:9" 1920, "4:3" 1440, "16:10" 1728, "1:1" 1080).

## Layout model (prefer flow over absolute)
Each <Slide layout="..."> defines slots. Children flow into slots automatically: the first <Title> goes
to the title slot, the first <Image> to the media slot (image layouts), everything else to the body.
Override with slot="left" etc. Only give an element x/y/w/h when it truly must float freely
(annotations, decorative shapes): absolute elements leave the flow.

Layouts:
${Object.values(layouts).map((l) => `- ${l.name}: ${l.description} Slots: ${l.slots.join(", ")}`).join("\n")}

## Slide props
layout (a built-in layout or one the theme defines), id, master (false hides the theme's master elements), background (color, CSS gradient, or image URL), variant ("default" | "inverse" | "accent"),
transition ("none" | "fade" | "slide" | "zoom"), columns (grid layout), notes (string, or use <Notes>).

## Elements (all accept the common props below)
- <Title>text</Title>, <Subtitle>text</Subtitle>
- <Text>markdown-lite</Text> — **bold**, *italic*, \`code\`, ==highlight==. Line breaks are kept;
  lines starting with "- " render as bullets.
- <List items={["One", "Two"]} ordered? /> — bullet list. Max ~5 items per slide.
- <Image src="https://..." alt="" fit="cover|contain" caption="" focus="50% 30%" zoom={1.2} /> — images the user
  uploaded are "assets/<name>" (listed in <deck_assets>); prefer them over stock photos. For placeholders use
  https://picsum.photos/seed/<word>/1200/800. focus/zoom crop the image inside its frame.
- <Icon name="rocket" size={96} color="accent" /> — any Lucide icon name in kebab-case (rocket, chart-line,
  shield-check, users, zap, globe, lock, clock, sparkles…). Pairs well with Stat or Card for feature grids.
- <Shape kind="rect|ellipse|line|arrow|triangle" fill stroke strokeWidth radius>optional label</Shape>
- <Chart type="bar|line|area|pie|donut" data={[{ month: "Jan", revenue: 12 }]} category="month" series="revenue" />
  series can be an array of keys for multiple series. Options: stacked, horizontal, legend, labels, title, unit.
- <Table columns={["Plan", "Price"]} rows={[["Pro", "$20"]]} />
- <Code lang="ts">{\`const x = 1\`}</Code>
- <Stat value="32%" label="Revenue growth" delta="+4 pts" />
- <Quote by="Ada Lovelace">text</Quote>
- <Row gap={48}>…</Row>, <Column gap={24}>…</Column>, <Card>…</Card> — containers for composing.
- Diagrams (prefer these over drawing boxes and arrows with Shape): they lay themselves out and fit their slot.
  <Flow direction="right|down"> with <Step> children — a process. Each step leads to the next one. For branches
    and loops give steps an id and set to="id id:label" on the step that branches, which replaces its default arrow
    (to="" ends a path). E.g. <Step kind="diamond" to="ship:Yes fix:No">Tests pass?</Step> … <Step id="ship" to="">Ship</Step>
    <Step id="fix" to="review">Fix</Step>.
    Step props: id, to, icon, note, kind ("box"|"pill"|"diamond"|"circle"), highlight.
  <Timeline> with <Step date="Q1 2026" note="…">Label</Step> children — milestones left to right; highlight marks "now".
  <Cycle> with <Step> children — a loop (3–6 steps).
  <Tree> with nested <Node sub="Ada Lovelace" icon="user">CEO<Node>…</Node></Node> — org charts and hierarchies.
  Keep labels short (1–4 words); put detail in note/sub.
- <Notes>speaker notes</Notes> — not shown on the slide; shown in presenter view.

Common props: id, slot, x, y, w, h, rotate, size ("xs"|"sm"|"md"|"lg"|"xl"|"2xl"|"3xl"|"4xl" or px),
color, align ("left"|"center"|"right"), weight, font ("heading"|"body"|"mono"), opacity, background,
step (build order in present mode: 1, 2, 3…), animate ("fade"|"rise"|"zoom"|"wipe").
Colors may be theme tokens: "accent", "muted", "text", "surface", "background", or any CSS color.

## Themes
theme="${Object.keys(themes).join('" | "')}", or theme={{ base: "snow", colors: { accent: "#3fa36b" }, fonts: { heading: "Fraunces" } }}.
${Object.values(themes).map((t) => `- ${t.name}: ${t.dark ? "dark" : "light"}, accent ${t.colors.accent}, headings in ${t.fonts.heading.split(",")[0]}`).join("\n")}

## Brand kit (company templates)
A theme object can carry a company's brand so every slide is on-brand without per-slide work. Put it in one
\`const brand = { ... }\` and pass theme={brand}. All keys are optional:
\`\`\`tsx
const brand = {
  base: "snow",                       // built-in theme to start from
  colors: { accent: "#0a7cff" },
  fonts: { heading: "assets/Acme-Bold.woff2", body: "assets/Acme-Regular.woff2" }, // font files are registered for you
  logo: { src: "assets/logo.svg", position: "top-right", height: 56, inverse: "assets/logo-white.svg" },
  footer: "Acme Corp · Confidential",  // {n}, {total} and {title} are replaced
  slideNumbers: true,
  master: <><Shape kind="rect" fill="accent" x={0} y={0} w={16} h={1080} /></>, // fixed elements on every slide
  layouts: {
    cover: { base: "title", variant: "inverse", master: false, elements: <><Image src="assets/hero.jpg" x={1100} y={0} w={820} h={1080} /></> },
    chapter: { base: "section", variant: "accent" },
  },
}
\`\`\`
- logo: "assets/<name>" or URL, or { src, position: "top-left"|"top-right"|"bottom-left"|"bottom-right", height, inverse }.
  inverse is used on inverse/accent slides.
- fonts: each of heading/body/mono is a family name, a font file ("assets/x.woff2", .woff, .ttf, .otf), an
  object { src, family, weight, style }, or an array of those for several weights of one family.
- footer and slide numbers sit in the bottom margin (y > 1000); keep content above it.
- master: JSX elements with x/y/w/h drawn behind every slide's content. They are part of the theme, not the
  slide: edit them in the theme, never copy them onto slides.
- layouts: company layouts. Use them like built-in ones: <Slide layout="cover">. base picks the built-in layout
  that places content; background/variant/transition are defaults the slide can override; elements are fixed
  elements for that layout; master: false hides the theme master, logo, footer and number.
- <Slide master={false}> hides the master elements, logo, footer and number on one slide.
When a deck has a brand kit, use its layouts and colors rather than inventing new styling.

## Data
\`csv\` turns CSV text into rows: const sales = csv\`month,revenue\\nJan,12\\nFeb,18\`
Then <Chart data={sales} category="month" series="revenue" />.

## Style guide for good slides
- One idea per slide. Titles are assertions ("Churn fell 40% after onboarding v2"), not topics ("Churn").
- ≤ 30 words of body text; ≤ 5 bullets; prefer a Stat, Chart or Image over a paragraph.
- Use layouts for structure; avoid absolute positioning unless the design needs it.
- Every content slide gets <Notes> with what the speaker should say.
- Vary layouts across the deck; use "section" slides to pace longer decks.
`
