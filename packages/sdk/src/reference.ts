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
layout, id, background (color, CSS gradient, or image URL), variant ("default" | "inverse" | "accent"),
transition ("none" | "fade" | "slide" | "zoom"), columns (grid layout), notes (string, or use <Notes>).

## Elements (all accept the common props below)
- <Title>text</Title>, <Subtitle>text</Subtitle>
- <Text>markdown-lite</Text> — **bold**, *italic*, \`code\`, ==highlight==. Line breaks are kept;
  lines starting with "- " render as bullets.
- <List items={["One", "Two"]} ordered? /> — bullet list. Max ~5 items per slide.
- <Image src="https://..." alt="" fit="cover|contain" caption="" /> — for placeholders use
  https://picsum.photos/seed/<word>/1200/800
- <Shape kind="rect|ellipse|line|arrow|triangle" fill stroke strokeWidth radius>optional label</Shape>
- <Chart type="bar|line|area|pie|donut" data={[{ month: "Jan", revenue: 12 }]} category="month" series="revenue" />
  series can be an array of keys for multiple series. Options: stacked, horizontal, legend, labels, title, unit.
- <Table columns={["Plan", "Price"]} rows={[["Pro", "$20"]]} />
- <Code lang="ts">{\`const x = 1\`}</Code>
- <Stat value="32%" label="Revenue growth" delta="+4 pts" />
- <Quote by="Ada Lovelace">text</Quote>
- <Row gap={48}>…</Row>, <Column gap={24}>…</Column>, <Card>…</Card> — containers for composing.
- <Notes>speaker notes</Notes> — not shown on the slide; shown in presenter view.

Common props: id, slot, x, y, w, h, rotate, size ("xs"|"sm"|"md"|"lg"|"xl"|"2xl"|"3xl"|"4xl" or px),
color, align ("left"|"center"|"right"), weight, font ("heading"|"body"|"mono"), opacity, background,
step (build order in present mode: 1, 2, 3…), animate ("fade"|"rise"|"zoom"|"wipe").
Colors may be theme tokens: "accent", "muted", "text", "surface", "background", or any CSS color.

## Themes
theme="${Object.keys(themes).join('" | "')}", or theme={{ base: "snow", colors: { accent: "#3fa36b" }, fonts: { heading: "Fraunces" } }}.
${Object.values(themes).map((t) => `- ${t.name}: ${t.dark ? "dark" : "light"}, accent ${t.colors.accent}, headings in ${t.fonts.heading.split(",")[0]}`).join("\n")}

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
