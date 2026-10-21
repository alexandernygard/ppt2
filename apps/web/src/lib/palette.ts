// Elements you can add: the Insert menu, the elements palette and drops on the canvas.

import { elementCode } from "@ppt2/sdk"
import {
  BarChart3Icon, BoxSelectIcon, CodeIcon, Columns3Icon, GitCommitHorizontalIcon, HashIcon, HeadingIcon, ImageIcon, ListIcon,
  MilestoneIcon, NetworkIcon, QuoteIcon, RectangleHorizontalIcon, RefreshCwIcon, Rows3Icon, ShapesIcon, SmileIcon, SquareDashedIcon,
  SubtitlesIcon, TableIcon, TypeIcon, WorkflowIcon, type LucideIcon,
} from "lucide-react"

export interface PaletteItem {
  type: string
  label: string
  icon: LucideIcon
  group: "Text" | "Media" | "Layout" | "Diagrams" | "Data" | "Component"
  /** Only shown where it can go: inside diagrams, or in a component's definition. */
  hint?: string
  code: () => string
}

export const PALETTE: PaletteItem[] = [
  { type: "title", label: "Title", icon: HeadingIcon, group: "Text", code: () => elementCode("title", {}, "New title") },
  { type: "subtitle", label: "Subtitle", icon: SubtitlesIcon, group: "Text", code: () => elementCode("subtitle", {}, "Subtitle") },
  { type: "text", label: "Text", icon: TypeIcon, group: "Text", code: () => elementCode("text", {}, "New text") },
  { type: "list", label: "Bullets", icon: ListIcon, group: "Text", code: () => elementCode("list", { items: ["First point", "Second point"] }) },
  { type: "stat", label: "Big number", icon: HashIcon, group: "Text", code: () => elementCode("stat", { value: "42%", label: "Something that grew" }) },
  { type: "quote", label: "Quote", icon: QuoteIcon, group: "Text", code: () => elementCode("quote", { by: "Someone wise" }, "A short, memorable line.") },

  { type: "image", label: "Image", icon: ImageIcon, group: "Media", code: () => elementCode("image", { src: `https://picsum.photos/seed/${Math.random().toString(36).slice(2, 7)}/1200/800`, alt: "" }) },
  { type: "icon", label: "Icon", icon: SmileIcon, group: "Media", code: () => elementCode("icon", { name: "sparkles" }) },
  { type: "shape", label: "Shape", icon: ShapesIcon, group: "Media", code: () => elementCode("shape", { kind: "rect", fill: "accent", w: 400, h: 300, radius: 24 }) },

  { type: "row", label: "Row", icon: Columns3Icon, group: "Layout", code: () => `<Row>\n  <Text>Left</Text>\n  <Text>Right</Text>\n</Row>` },
  { type: "column", label: "Column", icon: Rows3Icon, group: "Layout", code: () => `<Column>\n  <Text>Top</Text>\n  <Text>Bottom</Text>\n</Column>` },
  { type: "card", label: "Card", icon: RectangleHorizontalIcon, group: "Layout", code: () => `<Card>\n  <Title size="sm">Card title</Title>\n  <Text>A line about it.</Text>\n</Card>` },

  { type: "flow", label: "Process", icon: WorkflowIcon, group: "Diagrams", code: () => `<Flow>\n  <Step icon="lightbulb">Idea</Step>\n  <Step icon="pencil">Draft</Step>\n  <Step icon="users">Review</Step>\n  <Step icon="rocket" highlight>Ship</Step>\n</Flow>` },
  { type: "timeline", label: "Timeline", icon: MilestoneIcon, group: "Diagrams", code: () => `<Timeline>\n  <Step date="Q1">Research</Step>\n  <Step date="Q2">Beta</Step>\n  <Step date="Q3" highlight>Launch</Step>\n  <Step date="Q4">Scale</Step>\n</Timeline>` },
  { type: "tree", label: "Org chart", icon: NetworkIcon, group: "Diagrams", code: () => `<Tree>\n  <Node sub="Name">\n    CEO\n    <Node sub="Name">CTO</Node>\n    <Node sub="Name">COO</Node>\n    <Node sub="Name">CFO</Node>\n  </Node>\n</Tree>` },
  { type: "cycle", label: "Cycle", icon: RefreshCwIcon, group: "Diagrams", code: () => `<Cycle>\n  <Step icon="search">Discover</Step>\n  <Step icon="pencil-ruler">Design</Step>\n  <Step icon="hammer">Build</Step>\n  <Step icon="chart-line">Measure</Step>\n</Cycle>` },
  { type: "step", label: "Step", icon: GitCommitHorizontalIcon, group: "Diagrams", hint: "Drop into a process, timeline or cycle", code: () => elementCode("step", {}, "New step") },
  { type: "node", label: "Tree node", icon: BoxSelectIcon, group: "Diagrams", hint: "Drop into an org chart", code: () => elementCode("node", { sub: "Role" }, "Name") },

  { type: "chart", label: "Chart", icon: BarChart3Icon, group: "Data", code: () => elementCode("chart", { type: "bar", data: [{ label: "A", value: 3 }, { label: "B", value: 5 }, { label: "C", value: 8 }], category: "label", series: "value" }) },
  { type: "table", label: "Table", icon: TableIcon, group: "Data", code: () => elementCode("table", { columns: ["Plan", "Price"], rows: [["Basic", "$9"], ["Pro", "$29"]] }) },
  { type: "code", label: "Code", icon: CodeIcon, group: "Data", code: () => `<Code lang="ts">{\`const deck = compile(source)\`}</Code>` },

  { type: "slot", label: "Slot", icon: SquareDashedIcon, group: "Component", hint: "Where a component's children go", code: () => "<Slot />" },
]

export const paletteItem = (type: string) => PALETTE.find((p) => p.type === type)
