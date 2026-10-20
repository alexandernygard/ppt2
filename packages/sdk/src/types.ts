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
  | "icon"
  | "flow"
  | "tree"
  | "timeline"
  | "cycle"
  | "step"
  | "node"

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
    /** false hides the theme's master elements, logo, footer and slide number. */
    master?: boolean
  }
  /** The theme layout the slide uses (layout="cover"), if any; `layout` is then its base layout. */
  themeLayout?: string
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

export type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right"

/** A font file: "assets/Brand.woff2", a URL, or the file with explicit metadata. */
export type FontSource = string | { family?: string; src: string; weight?: number | string; style?: "normal" | "italic" }

/** A font file the renderer registers with @font-face. */
export interface ThemeFontFace {
  family: string
  src: string
  /** CSS font-weight descriptor; a range ("100 900") when the file's weight is unknown. */
  weight: string
  style: "normal" | "italic"
}

export interface ThemeLogo {
  /** "assets/<name>" or a URL. */
  src: string
  position: Corner
  /** Height in slide units. */
  height: number
  /** Logo for dark slides (variant inverse/accent, or a dark theme's default). */
  inverse?: string
}

/** A company layout: a built-in layout plus slide defaults and fixed elements. */
export interface ThemeLayout {
  name: string
  base: LayoutName
  description?: string
  /** Slide props the layout applies (background, variant, transition, master). The slide's own props win. */
  props: Record<string, unknown>
  /** Fixed elements drawn on every slide that uses the layout, behind the slide's content. */
  elements: ElementNode[]
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
  // --- brand kit ---
  logo?: ThemeLogo
  /** Footer text on every slide. {n}, {total} and {title} are replaced. */
  footer?: string
  slideNumbers?: boolean
  /** Font files to register; theme.fonts refers to them by family. */
  fontFaces?: ThemeFontFace[]
  /** Fixed elements drawn on every slide, behind its content. Paths are "m/<i>". */
  master?: ElementNode[]
  layouts?: Record<string, ThemeLayout>
}

export interface ThemeLayoutInput {
  /** Built-in layout that places the slide's content. Default "content". */
  base?: LayoutName
  description?: string
  background?: string
  variant?: "default" | "inverse" | "accent"
  transition?: Transition
  /** false: no theme master, logo, footer or number on this layout. */
  master?: boolean
  /** JSX: elements drawn on every slide with this layout. */
  elements?: unknown
}

export interface ThemeObjectInput extends Partial<Omit<Theme, "colors" | "fonts" | "logo" | "fontFaces" | "master" | "layouts">> {
  base?: string
  colors?: Partial<ThemeColors>
  /** Family names, or font files ("assets/Brand.woff2") that are registered for you. */
  fonts?: Partial<Record<keyof Theme["fonts"], string | FontSource | FontSource[]>>
  /** "assets/logo.svg", or the logo with options. */
  logo?: string | (Partial<ThemeLogo> & { src: string })
  /** JSX (a fragment or an array) drawn on every slide. */
  master?: unknown
  layouts?: Record<string, ThemeLayoutInput>
}

export type ThemeInput = string | ThemeObjectInput

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
