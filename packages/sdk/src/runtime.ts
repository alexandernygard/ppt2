// The runtime that deck code executes against: a JSX factory plus the
// component names. Components are plain strings at runtime and typed
// functions for TypeScript users.

import type {
  Animation,
  BaseProps,
  LayoutName,
  ThemeInput,
  Transition,
  Aspect,
} from "./types"

export interface PNode {
  $$ppt2: true
  type: string
  props: Record<string, any>
  children: Child[]
  src?: number
}
export type Child = PNode | string | number
type Children = unknown

type Component<P> = ((props: P & { children?: Children }) => PNode) & { __tag?: string }
const tag = <P,>(name: string) => name as unknown as Component<P>

export const Fragment = "fragment"

export function h(type: unknown, props: Record<string, any> | null, ...children: unknown[]): any {
  const { __src, ...rest } = props ?? {}
  if (typeof type === "function") {
    const kids = flatten(children)
    return type({ ...rest, children: kids.length <= 1 ? kids[0] : kids })
  }
  if (type === Fragment) return flatten(children)
  if (typeof type !== "string") throw new Error(`Unknown element type: ${String(type)}. Did you forget to import it?`)
  return { $$ppt2: true, type, props: rest, children: flatten(children), src: __src } satisfies PNode
}

export function flatten(children: unknown[]): Child[] {
  const out: Child[] = []
  for (const c of children) {
    if (c == null || c === false || c === true) continue
    if (Array.isArray(c)) out.push(...flatten(c))
    else out.push(c as Child)
  }
  return out
}

export function isPNode(v: unknown): v is PNode {
  return typeof v === "object" && v !== null && (v as PNode).$$ppt2 === true
}

// --- Components -----------------------------------------------------------

export interface DeckProps {
  title?: string
  theme?: ThemeInput
  aspect?: Aspect
  author?: string
}
export interface SlideProps {
  id?: string
  layout?: LayoutName
  background?: string
  variant?: "default" | "inverse" | "accent"
  transition?: Transition
  notes?: string
}
export interface ListProps extends BaseProps { items: string[]; ordered?: boolean }
export interface ImageProps extends BaseProps { src: string; alt?: string; fit?: "cover" | "contain"; caption?: string }
export interface ShapeProps extends BaseProps {
  kind?: "rect" | "ellipse" | "line" | "arrow" | "triangle"
  fill?: string
  stroke?: string
  strokeWidth?: number
  radius?: number
}
export interface ChartProps extends BaseProps {
  type?: "bar" | "line" | "area" | "pie" | "donut"
  data: Record<string, unknown>[]
  category: string
  series: string | string[]
  stacked?: boolean
  horizontal?: boolean
  legend?: boolean
  labels?: boolean
  title?: string
  unit?: string
}
export interface TableProps extends BaseProps { columns?: string[]; rows: (string | number)[][] }
export interface CodeProps extends BaseProps { lang?: string }
export interface StatProps extends BaseProps { value: string; label?: string; delta?: string }
export interface QuoteProps extends BaseProps { by?: string }
export interface StackProps extends BaseProps { gap?: number; justify?: "start" | "center" | "end" | "between"; items?: "start" | "center" | "end" | "stretch" }

export const Deck = tag<DeckProps>("deck")
export const Slide = tag<SlideProps>("slide")
export const Notes = tag<{}>("notes")
export const Title = tag<BaseProps>("title")
export const Subtitle = tag<BaseProps>("subtitle")
export const Text = tag<BaseProps>("text")
export const List = tag<ListProps>("list")
export const Image = tag<ImageProps>("image")
export const Shape = tag<ShapeProps>("shape")
export const Chart = tag<ChartProps>("chart")
export const Table = tag<TableProps>("table")
export const Code = tag<CodeProps>("code")
export const Stat = tag<StatProps>("stat")
export const Quote = tag<QuoteProps>("quote")
export const Row = tag<StackProps>("row")
export const Column = tag<StackProps>("column")
export const Card = tag<StackProps>("card")

/** Tag name in source for each element type. */
export const TAGS: Record<string, string> = {
  deck: "Deck", slide: "Slide", notes: "Notes", title: "Title", subtitle: "Subtitle", text: "Text",
  list: "List", image: "Image", shape: "Shape", chart: "Chart", table: "Table", code: "Code",
  stat: "Stat", quote: "Quote", row: "Row", column: "Column", card: "Card",
}

/** Parse CSV text into rows of objects. Numeric cells become numbers. */
export function csv(strings: TemplateStringsArray | string, ...values: unknown[]): Record<string, string | number>[] {
  const text = typeof strings === "string" ? strings : String.raw({ raw: strings }, ...values)
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return []
  const split = (l: string) => l.split(",").map((c) => c.trim().replace(/^"(.*)"$/, "$1"))
  const head = split(lines[0])
  return lines.slice(1).map((l) => {
    const cells = split(l)
    const row: Record<string, string | number> = {}
    head.forEach((k, i) => {
      const v = cells[i] ?? ""
      row[k] = v !== "" && !isNaN(Number(v)) ? Number(v) : v
    })
    return row
  })
}

export type { Animation }
