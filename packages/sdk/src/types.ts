// The resolved, render-ready model a ppt2 source compiles to.
// Renderers and exporters consume this; nobody edits it directly.
// The source code is the single source of truth.

export type Aspect = "16:9" | "4:3" | "16:10" | "1:1"

export type ElementType =
  | "title"
  | "subtitle"
  | "text"
  | "list"
  | "image"
  | "shape"
  | "chart"
  | "table"
  | "code"
  | "stat"
  | "quote"
  | "row"
  | "column"
  | "card"

export type LayoutName =
  | "title"
  | "section"
  | "content"
  | "two-column"
  | "image-left"
  | "image-right"
  | "statement"
  | "quote"
  | "grid"
  | "full-image"
  | "blank"

export type Transition = "none" | "fade" | "slide" | "zoom"
export type Animation = "fade" | "rise" | "zoom" | "wipe" | "none"
export type SizeToken = "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl"

/** Props every element accepts. Positions are in slide units (height is always 1080). */
export interface BaseProps {
  id?: string
  /** Put the element into a named layout slot instead of the automatic one. */
  slot?: string
  /** Absolute position. Setting any of x/y takes the element out of the layout flow. */
  x?: number
  y?: number
  w?: number
  h?: number
  rotate?: number
  /** Build step in present mode: 1 = appears on first advance. */
  step?: number
  animate?: Animation
  size?: SizeToken | number
  color?: string
  align?: "left" | "center" | "right"
  weight?: number | "normal" | "bold"
  font?: "heading" | "body" | "mono"
  opacity?: number
  background?: string
}

export interface ElementNode {
  type: ElementType
  /** Stable address within the deck: "slideIndex/childIndex[/childIndex...]". */
  path: string
  /** Character offset of the JSX element in the source. undefined for nodes built without the compiler. */
  src?: number
  props: BaseProps & Record<string, unknown>
  /** Text content for text-bearing elements. */
  text?: string
  children?: ElementNode[]
}

export interface SlideNode {
  index: number
  id: string
  src?: number
  layout: LayoutName
  props: Record<string, unknown> & {
    background?: string
    transition?: Transition
    variant?: "default" | "inverse" | "accent"
  }
  elements: ElementNode[]
  notes: string
  /** Where notes live in source: a <Notes> element or the notes prop. */
  notesSrc?: { kind: "element" | "prop"; src: number }
}

export interface ThemeColors {
  background: string
  surface: string
  text: string
  muted: string
  accent: string
  accentText: string
  border: string
  inverseBackground: string
  inverseText: string
  chart: string[]
}

export interface Theme {
  name: string
  label: string
  dark: boolean
  colors: ThemeColors
  fonts: { heading: string; body: string; mono: string }
  headingWeight: number
  headingTracking: number
  /** Corner radius for cards, images and shapes. */
  radius: number
  /** Decorative background treatment. */
  backdrop?: "none" | "gradient" | "grid" | "glow"
}

export type ThemeInput = string | (Partial<Omit<Theme, "colors" | "fonts">> & {
  base?: string
  colors?: Partial<ThemeColors>
  fonts?: Partial<Theme["fonts"]>
})

export interface DeckModel {
  title: string
  aspect: Aspect
  width: number
  height: number
  theme: Theme
  themeInput: ThemeInput
  slides: SlideNode[]
  src?: number
  props: Record<string, unknown>
}

export interface Diagnostic {
  severity: "error" | "warning" | "info"
  message: string
  line?: number
  column?: number
  /** Slide index the diagnostic is about, if any. */
  slide?: number
  path?: string
}

export interface CompileResult {
  deck?: DeckModel
  errors: Diagnostic[]
  warnings: Diagnostic[]
}
