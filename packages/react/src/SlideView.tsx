import { forwardRef, type CSSProperties, type ReactNode } from "react"
import { assignSlots, isAbsolute, type DeckModel, type ElementNode, type LayoutName, type SlideNode } from "@ppt2/sdk"
import { ElementView, RenderContext, SlotContext, type RenderOptions } from "./elements"
import { slideStyle, themeVars } from "./theme"
import "./styles"

const PAD_X = 120
const PAD_Y = 96

function Slot({ layout, slot, els, style }: { layout: LayoutName; slot: string; els: ElementNode[]; style?: CSSProperties }) {
  return (
    <SlotContext.Provider value={{ layout, slot }}>
      <div data-slot-name={slot} style={{ display: "flex", flexDirection: "column", gap: 40, minHeight: 0, minWidth: 0, overflow: "hidden", ...style }}>
        {els.map((el) => <ElementView key={el.path} el={el} />)}
      </div>
    </SlotContext.Provider>
  )
}

function Layout({ slide, width, height }: { slide: SlideNode; width: number; height: number }) {
  const layout = slide.layout
  const s = assignSlots(layout, slide.elements)
  const full: CSSProperties = { position: "absolute", inset: 0 }
  const padded: CSSProperties = { ...full, padding: `${PAD_Y}px ${PAD_X}px` }
  switch (layout) {
    case "title":
      return (
        <div style={{ ...padded, display: "flex", flexDirection: "column", justifyContent: "center", gap: 48 }}>
          <Slot layout={layout} slot="title" els={s.title} style={{ gap: 24, overflow: "visible" }} />
          <Slot layout={layout} slot="body" els={s.body} style={{ gap: 28 }} />
        </div>
      )
    case "section":
      return (
        <div style={{ ...padded, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 40, paddingBottom: 140 }}>
          <div style={{ width: 120, height: 12, background: "var(--p-accent)", borderRadius: 6 }} />
          <Slot layout={layout} slot="title" els={s.title} style={{ overflow: "visible" }} />
          <Slot layout={layout} slot="body" els={s.body} />
        </div>
      )
    case "two-column":
      return (
        <div style={{ ...padded, display: "grid", gridTemplateRows: "auto 1fr", gridTemplateColumns: "1fr 1fr", columnGap: 96, rowGap: 64 }}>
          <Slot layout={layout} slot="title" els={s.title} style={{ gridColumn: "1 / -1", overflow: "visible" }} />
          <Slot layout={layout} slot="left" els={s.left} style={{ justifyContent: "center" }} />
          <Slot layout={layout} slot="right" els={s.right} style={{ justifyContent: "center" }} />
        </div>
      )
    case "image-left":
    case "image-right": {
      const media = <div style={{ position: "relative", height: "100%", overflow: "hidden" }}><Slot layout={layout} slot="media" els={s.media} style={{ position: "absolute", inset: 0 }} /></div>
      const text = (
        <div style={{ padding: `${PAD_Y}px ${PAD_X * 0.8}px`, display: "flex", flexDirection: "column", justifyContent: "center", gap: 48, minHeight: 0 }}>
          <Slot layout={layout} slot="title" els={s.title} style={{ overflow: "visible" }} />
          <Slot layout={layout} slot="body" els={s.body} />
        </div>
      )
      return <div style={{ ...full, display: "grid", gridTemplateColumns: "1fr 1fr" }}>{layout === "image-left" ? <>{media}{text}</> : <>{text}{media}</>}</div>
    }
    case "statement":
    case "quote":
    case "blank":
      return (
        <div style={{ ...padded, display: "flex", flexDirection: "column", justifyContent: "center", padding: layout === "quote" ? `${PAD_Y}px 240px` : padded.padding }}>
          <Slot layout={layout} slot="body" els={s.body} style={{ alignItems: layout === "statement" ? "center" : "stretch", textAlign: layout === "statement" ? "center" : undefined, gap: 48 }} />
        </div>
      )
    case "grid": {
      const n = s.grid.length
      const cols = (slide.props.columns as number) ?? Math.min(Math.max(n, 1), n === 4 ? 2 : 3)
      return (
        <div style={{ ...padded, display: "grid", gridTemplateRows: "auto 1fr", rowGap: 64 }}>
          <Slot layout={layout} slot="title" els={s.title} style={{ overflow: "visible" }} />
          <SlotContext.Provider value={{ layout, slot: "grid" }}>
            <div data-slot-name="grid" style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 48, alignContent: "center", minHeight: 0 }}>
              {s.grid.map((el) => <ElementView key={el.path} el={el} />)}
            </div>
          </SlotContext.Provider>
        </div>
      )
    }
    case "full-image":
      return (
        <div style={full}>
          <Slot layout={layout} slot="media" els={s.media} style={{ position: "absolute", inset: 0 }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,.72), rgba(0,0,0,0) 60%)" }} />
          <Slot layout={layout} slot="body" els={s.body} style={{ position: "absolute", left: PAD_X, right: PAD_X, bottom: PAD_Y, color: "#fff", ["--p-text" as string]: "#fff", ["--p-muted" as string]: "rgba(255,255,255,.75)", gap: 24 } as CSSProperties} />
        </div>
      )
    case "content":
    default:
      return (
        <div style={{ ...padded, display: "grid", gridTemplateRows: "auto 1fr", rowGap: 56 }}>
          <Slot layout={layout} slot="title" els={s.title} style={{ overflow: "visible", gap: 16 }} />
          <Slot layout={layout} slot="body" els={s.body} />
        </div>
      )
  }
}

export interface SlideViewProps extends Partial<RenderOptions> {
  deck: DeckModel
  slide: SlideNode
  className?: string
  style?: CSSProperties
  children?: ReactNode
}

/** A slide at native resolution (deck.width × deck.height). Wrap in <Stage> to scale. */
export const SlideView = forwardRef<HTMLDivElement, SlideViewProps>(function SlideView({ deck, slide, mode = "static", step, overrides, hidden, className, style, children }, ref) {
  // Elements being dragged leave the flow immediately, so the preview matches the committed result.
  if (overrides && slide.elements.some((el) => overrides[el.path])) {
    slide = { ...slide, elements: slide.elements.map((el) => (overrides[el.path] ? { ...el, props: { ...el.props, ...overrides[el.path] } } : el)) }
  }
  const absolute = slide.elements.filter(isAbsolute)
  return (
    <RenderContext.Provider value={{ mode, step, overrides, hidden }}>
      <div
        ref={ref}
        data-slide-index={slide.index}
        className={className}
        style={{
          ...themeVars(deck.theme),
          ...slideStyle(deck.theme, slide),
          position: "relative",
          width: deck.width,
          height: deck.height,
          overflow: "hidden",
          color: "var(--p-text)",
          fontFamily: "var(--p-font-body)",
          fontSize: 38,
          lineHeight: 1.35,
          ...style,
        }}
      >
        <Layout slide={slide} width={deck.width} height={deck.height} />
        <SlotContext.Provider value={{ layout: slide.layout, slot: "free" }}>
          {absolute.map((el) => <ElementView key={el.path} el={el} absolute />)}
        </SlotContext.Provider>
        {children}
      </div>
    </RenderContext.Provider>
  )
})
