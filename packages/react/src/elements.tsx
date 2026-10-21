import { createContext, useContext, type CSSProperties, type ReactNode } from "react"
import type { ElementNode, LayoutName } from "@ppt2/sdk"
import {
  ChartContainer,
  CodeBlock,
  CodeBlockContent,
  Table as UITable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useHighlightedCode,
  type ChartConfig,
} from "@alexandernygard/components"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart, Pie, PieChart, XAxis, YAxis } from "recharts"
import { color, fontSize } from "./theme"
import { BulletList, Markdown } from "./markdown"
import { resolveSrc } from "./assets"
import { iconFor } from "./icons"
import { DiagramEl } from "./diagrams"

export type Box = { x?: number; y?: number; w?: number; h?: number }
/** Live, uncommitted prop changes while a gesture is in progress (geometry, crop). */
export type Override = Box & Record<string, unknown>

export interface RenderOptions {
  mode: "edit" | "present" | "static"
  /** Present mode: current build step. Elements with a higher step are hidden. */
  step?: number
  /** Live geometry or props while dragging, resizing or cropping, keyed by element path. */
  overrides?: Record<string, Override>
  /** Paths to hide (e.g. while being edited inline). */
  hidden?: Set<string>
}

export const RenderContext = createContext<RenderOptions>({ mode: "static" })
export const SlotContext = createContext<{ layout: LayoutName; slot: string }>({ layout: "content", slot: "body" })

const heading: CSSProperties = {
  fontFamily: "var(--p-font-heading)",
  fontWeight: "var(--p-heading-weight)" as unknown as number,
  letterSpacing: "var(--p-heading-tracking)",
  lineHeight: 1.05,
  margin: 0,
  textWrap: "balance",
}

function titleSize(layout: LayoutName) {
  if (layout === "title" || layout === "section") return 120
  if (layout === "statement") return 104
  return 72
}

const GROWS = new Set(["chart", "image", "table", "code", "flow", "tree", "timeline", "cycle"])

/** Wraps every element: positioning, common style props, build steps and the data-path hook for editing. */
export function ElementView({ el: node, absolute }: { el: ElementNode; absolute?: boolean }) {
  const opts = useContext(RenderContext)
  const { layout, slot } = useContext(SlotContext)
  const live = opts.overrides?.[node.path]
  const el = live ? { ...node, props: { ...node.props, ...live } } : node
  const p = el.props
  const box = { x: p.x, y: p.y, w: p.w, h: p.h, ...opts.overrides?.[el.path] }
  const isAbs = absolute || box.x != null || box.y != null
  const hiddenByStep = opts.mode === "present" && typeof p.step === "number" && p.step > (opts.step ?? 0)
  const animate = opts.mode === "present" && typeof p.step === "number" && !hiddenByStep ? (p.animate ?? "fade") : undefined

  const style: CSSProperties = {
    position: isAbs ? "absolute" : "relative",
    left: isAbs ? (box.x ?? 0) : undefined,
    top: isAbs ? (box.y ?? 0) : undefined,
    width: box.w ?? (isAbs ? undefined : undefined),
    height: box.h,
    transform: p.rotate ? `rotate(${p.rotate}deg)` : undefined,
    opacity: p.opacity as number | undefined,
    color: color(p.color),
    textAlign: p.align as CSSProperties["textAlign"],
    fontWeight: p.weight as CSSProperties["fontWeight"],
    fontFamily: p.font ? `var(--p-font-${p.font})` : undefined,
    background: color(p.background),
    visibility: hiddenByStep || opts.hidden?.has(el.path) ? "hidden" : undefined,
    minHeight: 0,
    minWidth: 0,
    flex: !isAbs && GROWS.has(el.type) && box.h == null && slot !== "media" ? "1 1 0" : undefined,
    padding: p.background && el.type !== "card" ? "0.4em 0.6em" : undefined,
    borderRadius: p.background ? "var(--p-radius)" : undefined,
  }
  if (slot === "media" && !isAbs) Object.assign(style, { position: "absolute", inset: 0 })

  return (
    <div data-path={el.path} data-type={el.type} style={style} className={animate ? `ppt2-anim-${animate}` : undefined}>
      <ElementBody el={el} layout={layout} slot={slot} />
    </div>
  )
}

function ElementBody({ el, layout, slot }: { el: ElementNode; layout: LayoutName; slot: string }) {
  const p = el.props
  const text = el.text ?? ""
  switch (el.type) {
    case "title":
      return <h1 style={{ ...heading, fontSize: fontSize(p.size, titleSize(layout)) }}>{text}</h1>
    case "subtitle":
      return <h2 style={{ ...heading, fontWeight: 400, letterSpacing: 0, color: p.color ? undefined : "var(--p-muted)", fontFamily: "var(--p-font-body)", lineHeight: 1.25, fontSize: fontSize(p.size, layout === "title" ? 48 : 40) }}>{text}</h2>
    case "text":
      return <div style={{ fontSize: fontSize(p.size, 38), lineHeight: 1.4, textWrap: "pretty" }}><Markdown text={text} /></div>
    case "list":
      return <div style={{ fontSize: fontSize(p.size, 40), lineHeight: 1.3 }}><BulletList items={(p.items as string[]) ?? []} ordered={!!p.ordered} /></div>
    case "image":
      return <ImageEl el={el} bleed={slot === "media"} />
    case "shape":
      return <ShapeEl el={el} />
    case "chart":
      return <ChartEl el={el} />
    case "table":
      return <TableEl el={el} />
    case "code":
      return <CodeEl el={el} />
    case "stat":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ ...heading, fontSize: fontSize(p.size, 140), lineHeight: 1, color: p.color ? undefined : "var(--p-text)" }}>{String(p.value ?? text)}</div>
          {p.label ? <div style={{ fontSize: 34, color: "var(--p-muted)", lineHeight: 1.25 }}>{String(p.label)}</div> : null}
          {p.delta ? <div style={{ fontSize: 30, color: "var(--p-accent)", fontWeight: 600 }}>{String(p.delta)}</div> : null}
        </div>
      )
    case "quote":
      return (
        <figure style={{ margin: 0, display: "flex", flexDirection: "column", gap: 40 }}>
          <blockquote style={{ ...heading, margin: 0, fontSize: fontSize(p.size, 72), lineHeight: 1.15, position: "relative" }}>
            <span aria-hidden style={{ color: "var(--p-accent)", position: "absolute", left: "-0.55em", top: "-0.05em" }}>“</span>
            {text}
          </blockquote>
          {p.by ? <figcaption style={{ fontSize: 34, color: "var(--p-muted)" }}>— {String(p.by)}</figcaption> : null}
        </figure>
      )
    case "row":
    case "column":
    case "card":
      return <Container el={el} />
    case "icon":
      return <IconEl el={el} />
    case "flow":
    case "tree":
    case "timeline":
    case "cycle":
      return <DiagramEl el={el} />
    case "slot":
      // Only drawn while editing a component's definition.
      return (
        <div style={{ minHeight: 120, height: "100%", display: "grid", placeItems: "center", border: "3px dashed #8b5cf6", borderRadius: "var(--p-radius)", background: "rgba(139,92,246,.08)", color: "#7c3aed", fontSize: 26, fontFamily: "system-ui" }}>
          Children go here
        </div>
      )
    default:
      return null
  }
}

const JUSTIFY = { start: "flex-start", center: "center", end: "flex-end", between: "space-between" } as const

function Container({ el }: { el: ElementNode }) {
  const p = el.props
  const row = el.type === "row"
  const card = el.type === "card"
  const style: CSSProperties = {
    display: "flex",
    flexDirection: row ? "row" : "column",
    gap: (p.gap as number) ?? (row ? 48 : 24),
    justifyContent: JUSTIFY[(p.justify as keyof typeof JUSTIFY) ?? (card ? "center" : "start")],
    alignItems: p.items === "stretch" || p.items == null ? "stretch" : p.items === "start" ? "flex-start" : p.items === "end" ? "flex-end" : "center",
    height: "100%",
    ...(card ? { background: p.background ? undefined : "var(--p-surface)", border: "2px solid var(--p-border)", borderRadius: "var(--p-radius)", padding: 48 } : {}),
  }
  return (
    <div style={style}>
      {el.children?.map((c) => (
        <div key={c.path} style={{ flex: row ? "1 1 0" : undefined, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <ElementView el={c} />
        </div>
      ))}
    </div>
  )
}

function ImageEl({ el, bleed }: { el: ElementNode; bleed: boolean }) {
  const p = el.props
  const focus = typeof p.focus === "string" && p.focus ? p.focus : "50% 50%"
  const zoom = typeof p.zoom === "number" && p.zoom > 0 ? p.zoom : 1
  const src = resolveSrc(p.src)
  return (
    <figure style={{ margin: 0, width: "100%", height: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
      <div data-frame style={{ position: "relative", flex: 1, minHeight: 0, width: "100%", height: "100%", overflow: "hidden", borderRadius: bleed ? 0 : "var(--p-radius)", background: src ? undefined : "var(--p-surface)" }}>
        {src ? (
          <img
            src={src}
            alt={String(p.alt ?? "")}
            draggable={false}
            crossOrigin={src.startsWith("blob:") || src.startsWith("data:") ? undefined : "anonymous"}
            style={{ width: "100%", height: "100%", objectFit: (p.fit as "cover" | "contain") ?? "cover", objectPosition: focus, transform: zoom !== 1 ? `scale(${zoom})` : undefined, transformOrigin: focus, display: "block" }}
          />
        ) : (
          <div data-missing-asset={String(p.src ?? "")} style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "var(--p-muted)", fontSize: 26, border: "3px dashed var(--p-border)", borderRadius: "inherit" }}>{p.src ? `Missing image: ${String(p.src)}` : "No image"}</div>
        )}
      </div>
      {p.caption ? <figcaption style={{ fontSize: 26, color: "var(--p-muted)" }}>{String(p.caption)}</figcaption> : null}
    </figure>
  )
}

function IconEl({ el }: { el: ElementNode }) {
  const p = el.props
  const Icon = iconFor(p.name)
  const size = fontSize(p.size, 96)
  const justify = p.align === "center" ? "center" : p.align === "right" ? "flex-end" : "flex-start"
  const box = p.w != null || p.h != null
  return (
    <div style={{ display: "flex", justifyContent: justify, alignItems: "center", width: box ? "100%" : undefined, height: box ? "100%" : undefined, color: color(p.color) ?? "var(--p-accent)" }}>
      {Icon ? (
        <Icon width={box ? "100%" : size} height={box ? "100%" : size} strokeWidth={(p.strokeWidth as number) ?? 1.75} absoluteStrokeWidth={false} />
      ) : (
        <div data-missing-icon={String(p.name ?? "")} style={{ width: size, height: size, display: "grid", placeItems: "center", border: "3px dashed currentColor", borderRadius: 16, fontSize: size * 0.4, opacity: 0.6 }}>?</div>
      )}
    </div>
  )
}

function ShapeEl({ el }: { el: ElementNode }) {
  const p = el.props
  const kind = (p.kind as string) ?? "rect"
  const fill = color(p.fill) ?? (kind === "line" || kind === "arrow" ? "none" : "var(--p-accent)")
  const stroke = color(p.stroke) ?? (kind === "line" || kind === "arrow" ? "var(--p-text)" : "none")
  const sw = (p.strokeWidth as number) ?? (kind === "line" || kind === "arrow" ? 6 : 0)
  const r = (p.radius as number) ?? 0
  const hasSize = p.h != null
  return (
    <div style={{ position: "relative", width: "100%", height: hasSize ? "100%" : 200 }}>
      <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <defs>
          <marker id={`arrow-${el.path}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={stroke} />
          </marker>
        </defs>
        {kind === "rect" && <rect x="0" y="0" width="100" height="100" rx={r ? Math.min(50, r / 4) : 0} fill={fill} stroke={stroke} strokeWidth={sw} vectorEffect="non-scaling-stroke" />}
        {kind === "ellipse" && <ellipse cx="50" cy="50" rx="50" ry="50" fill={fill} stroke={stroke} strokeWidth={sw} vectorEffect="non-scaling-stroke" />}
        {kind === "triangle" && <polygon points="50,0 100,100 0,100" fill={fill} stroke={stroke} strokeWidth={sw} vectorEffect="non-scaling-stroke" />}
        {(kind === "line" || kind === "arrow") && (
          <line x1="0" y1="50" x2="100" y2="50" stroke={stroke} strokeWidth={sw} vectorEffect="non-scaling-stroke" markerEnd={kind === "arrow" ? `url(#arrow-${el.path})` : undefined} />
        )}
      </svg>
      {el.text ? (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 24, fontSize: fontSize(p.size, 36), color: p.color ? undefined : "var(--p-accent-text)", fontWeight: 600 }}>
          {el.text}
        </div>
      ) : null}
    </div>
  )
}

function ChartEl({ el }: { el: ElementNode }) {
  const { mode } = useContext(RenderContext)
  const p = el.props
  const data = (Array.isArray(p.data) ? p.data : []) as Record<string, unknown>[]
  const category = String(p.category ?? "")
  const series = (Array.isArray(p.series) ? p.series : p.series ? [p.series] : []) as string[]
  const type = (p.type as string) ?? "bar"
  const animate = mode === "present"
  const config: ChartConfig = Object.fromEntries(series.map((s, i) => [s, { label: s, color: `var(--p-chart-${(i % 5) + 1})` }]))
  const unit = p.unit ? String(p.unit) : ""
  const tick = { fill: "var(--p-muted)", fontSize: 26 }
  const axisProps = { tickLine: false, axisLine: false, tick }
  const legend = p.legend || series.length > 1 ? <Legend verticalAlign="top" align="right" wrapperStyle={{ fontSize: 28, color: "var(--p-text)", paddingBottom: 24 }} iconType="circle" iconSize={18} /> : null
  const labelProps = { fill: "var(--p-text)", fontSize: 26, formatter: (v: unknown) => `${v}${unit}` }
  let chart: ReactNode
  const horizontal = !!p.horizontal

  if (type === "pie" || type === "donut") {
    const s = series[0]
    chart = (
      <PieChart>
        <Pie data={data} dataKey={s} nameKey={category} innerRadius={type === "donut" ? "55%" : 0} outerRadius="85%" isAnimationActive={animate} stroke="var(--p-background)" strokeWidth={4} label={{ fill: "var(--p-text)", fontSize: 28 }}>
          {data.map((_, i) => <Cell key={i} fill={`var(--p-chart-${(i % 5) + 1})`} />)}
        </Pie>
        <Legend wrapperStyle={{ fontSize: 28, color: "var(--p-text)" }} iconType="circle" iconSize={18} />
      </PieChart>
    )
  } else if (type === "line" || type === "area") {
    const Chart = type === "line" ? LineChart : AreaChart
    chart = (
      <Chart data={data} margin={{ top: 24, right: 24, left: 8, bottom: 8 }}>
        <CartesianGrid vertical={false} stroke="var(--p-border)" />
        <XAxis dataKey={category} {...axisProps} tickMargin={16} />
        <YAxis {...axisProps} width={90} tickFormatter={(v) => `${v}${unit}`} />
        {series.map((s, i) =>
          type === "line" ? (
            <Line key={s} dataKey={s} type="monotone" stroke={`var(--color-${s})`} strokeWidth={6} dot={{ r: 7, fill: `var(--color-${s})` }} isAnimationActive={animate}>
              {p.labels ? <LabelList position="top" {...labelProps} /> : null}
            </Line>
          ) : (
            <Area key={s} dataKey={s} type="monotone" stroke={`var(--color-${s})`} strokeWidth={4} fill={`var(--color-${s})`} fillOpacity={0.25} stackId={p.stacked ? "a" : undefined} isAnimationActive={animate} />
          ),
        )}
        {legend}
      </Chart>
    )
  } else {
    chart = (
      <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 32, right: 24, left: 8, bottom: 8 }}>
        <CartesianGrid vertical={horizontal} horizontal={!horizontal} stroke="var(--p-border)" />
        {horizontal ? (
          <>
            <XAxis type="number" {...axisProps} tickFormatter={(v) => `${v}${unit}`} />
            <YAxis type="category" dataKey={category} {...axisProps} width={220} />
          </>
        ) : (
          <>
            <XAxis dataKey={category} {...axisProps} tickMargin={16} />
            <YAxis {...axisProps} width={90} tickFormatter={(v) => `${v}${unit}`} />
          </>
        )}
        {series.map((s) => (
          <Bar key={s} dataKey={s} fill={`var(--color-${s})`} radius={p.stacked ? 0 : 10} stackId={p.stacked ? "a" : undefined} isAnimationActive={animate} maxBarSize={140}>
            {p.labels ? <LabelList position={horizontal ? "right" : "top"} {...labelProps} /> : null}
          </Bar>
        ))}
        {legend}
      </BarChart>
    )
  }

  return (
    <div style={{ width: "100%", height: "100%", minHeight: 320, display: "flex", flexDirection: "column", gap: 12 }}>
      {p.title ? <div style={{ fontSize: 32, color: "var(--p-muted)" }}>{String(p.title)}</div> : null}
      <ChartContainer config={config} className="aspect-auto! h-full! w-full min-h-0 flex-1 [&_.recharts-cartesian-axis-tick_text]:fill-(--p-muted)! [&_.recharts-cartesian-grid_line]:stroke-(--p-border)!" initialDimension={{ width: 1200, height: 600 }}>
        {chart as any}
      </ChartContainer>
    </div>
  )
}
function TableEl({ el }: { el: ElementNode }) {
  const p = el.props
  const columns = (p.columns as string[]) ?? []
  const rows = (p.rows as (string | number)[][]) ?? []
  const fs = fontSize(p.size, 30)
  return (
    <UITable style={{ fontSize: fs, color: "var(--p-text)" }}>
      {columns.length ? (
        <TableHeader>
          <TableRow style={{ borderColor: "var(--p-border)", borderBottomWidth: 3 }}>
            {columns.map((c, i) => <TableHead key={i} style={{ color: "var(--p-muted)", fontSize: fs * 0.85, height: "auto", padding: "0.5em 0.6em", fontWeight: 600 }}>{c}</TableHead>)}
          </TableRow>
        </TableHeader>
      ) : null}
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={i} style={{ borderColor: "var(--p-border)", borderBottomWidth: 2 }}>
            {r.map((c, j) => <TableCell key={j} style={{ padding: "0.5em 0.6em", whiteSpace: "normal", fontWeight: j === 0 ? 600 : 400 }}>{String(c)}</TableCell>)}
          </TableRow>
        ))}
      </TableBody>
    </UITable>
  )
}

function CodeEl({ el }: { el: ElementNode }) {
  const p = el.props
  const lines = useHighlightedCode(el.text ?? "", String(p.lang ?? "tsx"))
  return (
    <CodeBlock style={{ fontSize: fontSize(p.size, 30), background: "var(--p-surface)", borderColor: "var(--p-border)", borderRadius: "var(--p-radius)", height: "100%", color: "var(--p-text)" }}>
      <CodeBlockContent style={{ padding: "1em 1.2em", fontFamily: "var(--p-font-mono)" }}>
        {lines.map((l, i) => <span key={i} style={{ display: "block", minHeight: "1lh" }}>{l}</span>)}
      </CodeBlockContent>
    </CodeBlock>
  )
}
