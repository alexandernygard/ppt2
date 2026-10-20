// Diagrams: Flow, Tree, Timeline and Cycle. The source only says what the
// steps are and how they connect; layout (dagre for graphs, geometry for the
// rest) happens here, in a virtual canvas that is scaled to fit its box.

import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { Graph, layout as dagreLayout } from "@dagrejs/dagre"
import type { ElementNode } from "@ppt2/sdk"
import { iconFor } from "./icons"

type P = { x: number; y: number }
type Placed = { el: ElementNode; x: number; y: number; w: number; h: number } // x/y = center
type Edge = { points: P[]; label?: string; at?: P; arc?: { r: number; large: boolean }; from?: Placed; to?: Placed }
interface Laid { nodes: Placed[]; edges: Edge[]; width: number; height: number; arrows: boolean; elbows?: "TB" | "LR"; axis?: { y: number; x1: number; x2: number } }

const LABEL = 34
const NOTE = 24
const CHAR = 0.56 // average glyph width in em

const lines = (text: string, fs: number, width: number) => {
  let n = 1, line = 0
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const w = (word.length + 1) * fs * CHAR
    if (line && line + w > width) { n++; line = w } else line += w
  }
  return text.trim() ? n : 0
}

/** One size for every node in a diagram, from its longest label. Uniform boxes read as a system. */
function nodeSize(items: ElementNode[], opts: { min: number; max: number }) {
  const longest = Math.max(...items.map((s) => Math.max(...(s.text ?? "").split(/\s+/).map((w) => w.length), Math.min((s.text ?? "").length, 18))), 4)
  const w = Math.max(opts.min, Math.min(opts.max, longest * LABEL * CHAR + 80))
  const inner = w - 56
  const h = Math.max(...items.map((s) => {
    const p = s.props
    let hh = 48 + lines(s.text ?? "", LABEL, inner) * LABEL * 1.2
    if (iconFor(p.icon)) hh += 64
    if (p.note) hh += 10 + lines(String(p.note), NOTE, inner) * NOTE * 1.3
    if (p.sub) hh += 8 + lines(String(p.sub), 26, inner) * 26 * 1.3
    return hh
  }))
  return { w, h }
}

function graphLayout(items: Placed[], edges: { from: string; to: string; label?: string }[], ids: string[], rankdir: "LR" | "TB", sep: { node: number; rank: number }): Laid {
  const g = new Graph()
  g.setGraph({ rankdir, nodesep: sep.node, ranksep: sep.rank, edgesep: 24, marginx: 12, marginy: 12 })
  g.setDefaultEdgeLabel(() => ({}))
  items.forEach((n, i) => g.setNode(ids[i], { width: n.w, height: n.h }))
  for (const e of edges) {
    if (!g.hasNode(e.from) || !g.hasNode(e.to)) continue
    g.setEdge(e.from, e.to, e.label ? { label: e.label, width: e.label.length * 26 * CHAR + 24, height: 40, labelpos: "c" } : {})
  }
  dagreLayout(g)
  const nodes = items.map((n, i) => { const d = g.node(ids[i]); return { ...n, x: d.x, y: d.y } })
  const byId = new Map(ids.map((id, i) => [id, nodes[i]]))
  const out: Edge[] = g.edges().map((e) => {
    const d = g.edge(e) as { points: P[]; label?: string; x?: number; y?: number }
    return { points: d.points, label: d.label, at: d.label ? { x: d.x!, y: d.y! } : undefined, from: byId.get(e.v), to: byId.get(e.w) }
  })
  const gr = g.graph() as { width?: number; height?: number }
  return { nodes, edges: out, width: gr.width ?? 0, height: gr.height ?? 0, arrows: true }
}

function layoutFlow(el: ElementNode): Laid {
  const steps = el.children ?? []
  const size = nodeSize(steps, { min: 220, max: 420 })
  const ids = steps.map((s, i) => String(s.props.id ?? `#${i}`))
  // Steps lead to the next step, unless `to` says where they go (to="" ends the path).
  const edges = steps.flatMap((s, i) => s.props.to == null
    ? (i < steps.length - 1 ? [{ from: ids[i], to: ids[i + 1] }] : [])
    : String(s.props.to).split(/\s+/).filter(Boolean).map((t) => {
        const [to, ...label] = t.split(":")
        return { from: ids[i], to, label: label.join(":").replace(/_/g, " ") || undefined }
      }))
  const placed = steps.map((s) => {
    const kind = s.props.kind
    const w = kind === "diamond" ? size.w * 1.3 : kind === "circle" ? Math.max(size.w, size.h) : size.w
    const h = kind === "diamond" ? size.h * 1.5 : kind === "circle" ? w : size.h
    return { el: s, x: 0, y: 0, w, h }
  })
  return graphLayout(placed, edges, ids, el.props.direction === "down" ? "TB" : "LR", { node: 64, rank: 110 })
}

/** A tidy tree: each subtree gets the width of its leaves, children keep source order, parents center over them. */
function layoutTree(el: ElementNode): Laid {
  const all: ElementNode[] = []
  const walk = (n: ElementNode) => { all.push(n); n.children?.forEach(walk) }
  el.children?.forEach(walk)
  const size = nodeSize(all, { min: 240, max: 380 })
  const across = el.props.direction === "right" ? size.h : size.w // extent along a level
  const along = el.props.direction === "right" ? size.w : size.h // extent between levels
  const GAP = 40, RANK = 90
  const span = new Map<ElementNode, number>()
  const measure = (n: ElementNode): number => {
    const kids = n.children ?? []
    const w = kids.length ? Math.max(across, kids.reduce((t, k) => t + measure(k), 0) + GAP * (kids.length - 1)) : across
    span.set(n, w)
    return w
  }
  const placed: Placed[] = []
  const edges: Edge[] = []
  let depth = 0
  const place = (n: ElementNode, start: number, level: number, parent?: Placed): void => {
    depth = Math.max(depth, level)
    const a = start + span.get(n)! / 2, b = level * (along + RANK) + along / 2
    const p: Placed = el.props.direction === "right" ? { el: n, x: b, y: a, w: size.w, h: size.h } : { el: n, x: a, y: b, w: size.w, h: size.h }
    placed.push(p)
    if (parent) edges.push({ points: [], from: parent, to: p })
    const kids = n.children ?? []
    let at = a - (kids.reduce((t, k) => t + span.get(k)!, 0) + GAP * (kids.length - 1)) / 2
    for (const k of kids) { place(k, at, level + 1, p); at += span.get(k)! + GAP }
  }
  const roots = el.children ?? []
  let at = 0
  for (const r of roots) { measure(r); place(r, at, 0); at += span.get(r)! + GAP }
  const extentAcross = at - GAP, extentAlong = (depth + 1) * along + depth * RANK
  const right = el.props.direction === "right"
  return { nodes: placed, edges, width: right ? extentAlong : extentAcross, height: right ? extentAcross : extentAlong, arrows: false, elbows: right ? "LR" : "TB" }
}

function layoutTimeline(el: ElementNode): Laid {
  const steps = el.children ?? []
  const col = Math.max(260, Math.min(400, nodeSize(steps, { min: 240, max: 400 }).w))
  const inner = col - 32
  const dateH = 48
  const bodyH = Math.max(...steps.map((s) => lines(s.text ?? "", LABEL, inner) * LABEL * 1.2 + (s.props.note ? 10 + lines(String(s.props.note), NOTE, inner) * NOTE * 1.3 : 0)), 0)
  const axisY = dateH + 44
  const h = axisY + 44 + bodyH
  const nodes = steps.map((s, i) => ({ el: s, x: col * i + col / 2, y: h / 2, w: col - 16, h }))
  return { nodes, edges: [], width: col * steps.length, height: h, arrows: false, axis: { y: axisY, x1: col / 2, x2: col * (steps.length - 0.5) } }
}

function layoutCycle(el: ElementNode): Laid {
  const steps = el.children ?? []
  const n = Math.max(steps.length, 1)
  const size = nodeSize(steps, { min: 220, max: 340 })
  const r = Math.max(240, (Math.max(size.w, size.h) + 70) / (2 * Math.sin(Math.PI / Math.max(n, 3))))
  const cx = r + size.w / 2, cy = r + size.h / 2
  const angle = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n
  const nodes = steps.map((s, i) => ({ el: s, x: cx + r * Math.cos(angle(i)), y: cy + r * Math.sin(angle(i)), w: size.w, h: size.h }))
  // Arc ends where the circle leaves each node's box (plus a gap), found by stepping along the circle.
  const inside = (p: P, nd: Placed) => Math.abs(p.x - nd.x) < nd.w / 2 + 18 && Math.abs(p.y - nd.y) < nd.h / 2 + 18
  const exit = (i: number, dir: 1 | -1) => {
    let a = angle(i)
    for (let k = 0; k < 400 && inside({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }, nodes[i]); k++) a += dir * 0.005
    return a
  }
  const at = (a: number) => ({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) })
  const edges: Edge[] = n < 2 ? [] : nodes.map((_, i) => {
    const a1 = exit(i, 1)
    let a2 = exit((i + 1) % n, -1)
    if (a2 < a1) a2 += 2 * Math.PI
    return { points: [at(a1), at(a2)], arc: { r, large: a2 - a1 > Math.PI } }
  })
  return { nodes, edges, width: 2 * r + size.w, height: 2 * r + size.h, arrows: true }
}

const LAYOUTS: Record<string, (el: ElementNode) => Laid> = { flow: layoutFlow, tree: layoutTree, timeline: layoutTimeline, cycle: layoutCycle }

function curve(pts: P[]) {
  if (pts.length < 3) return `M ${pts.map((p) => `${p.x} ${p.y}`).join(" L ")}`
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 1; i < pts.length - 1; i++) {
    const m = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 }
    d += ` Q ${pts[i].x} ${pts[i].y} ${i === pts.length - 2 ? `${pts[i + 1].x} ${pts[i + 1].y}` : `${m.x} ${m.y}`}`
  }
  return d
}

/** Scale a virtual canvas to fit the element's box, centered. With no height to fill, height follows the content. */
function Fit({ width, height, children, max = 1.5 }: { width: number; height: number; children: ReactNode; max?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ w: number; h: number } | null>(null)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const read = () => setBox((b) => (b && b.w === node.clientWidth && b.h === node.clientHeight ? b : { w: node.clientWidth, h: node.clientHeight }))
    read()
    const ro = new ResizeObserver(read)
    ro.observe(node)
    return () => ro.disconnect()
  }, [])
  const cw = box?.w || 1600
  const freeHeight = !box || box.h < 60
  const scale = Math.min(cw / width, freeHeight ? max : box!.h / height, max)
  const ch = freeHeight ? height * scale : box!.h
  return (
    <div ref={ref} data-diagram-scale={scale.toFixed(2)} style={{ position: "relative", width: "100%", height: freeHeight ? ch : "100%", minHeight: 0 }}>
      <div style={{ position: "absolute", left: (cw - width * scale) / 2, top: (ch - height * scale) / 2, width, height, transform: `scale(${scale})`, transformOrigin: "0 0" }}>
        {children}
      </div>
    </div>
  )
}

function NodeBody({ el, kind, align = "center" }: { el: ElementNode; kind?: string; align?: "center" | "left" }) {
  const p = el.props
  const Icon = iconFor(p.icon)
  const hi = !!p.highlight
  return (
    <div style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column", alignItems: align === "center" ? "center" : "flex-start", justifyContent: "center", textAlign: align, gap: 8, padding: kind === "diamond" ? "0 18%" : "0 28px" }}>
      {Icon && <Icon size={52} strokeWidth={1.75} color={hi ? "var(--p-accent-text)" : "var(--p-accent)"} style={{ flexShrink: 0, marginBottom: 4 }} />}
      <div data-text style={{ fontSize: LABEL, fontWeight: 600, lineHeight: 1.2, textWrap: "balance" }}>{el.text}</div>
      {p.sub ? <div style={{ fontSize: 26, lineHeight: 1.3, color: hi ? "inherit" : "var(--p-muted)", opacity: hi ? 0.8 : 1 }}>{String(p.sub)}</div> : null}
      {p.note ? <div style={{ fontSize: NOTE, lineHeight: 1.3, color: hi ? "inherit" : "var(--p-muted)", opacity: hi ? 0.8 : 1 }}>{String(p.note)}</div> : null}
    </div>
  )
}

function nodeStyle(n: Placed, kind: unknown): CSSProperties {
  const hi = !!n.el.props.highlight
  const base: CSSProperties = { position: "absolute", left: n.x - n.w / 2, top: n.y - n.h / 2, width: n.w, height: n.h, color: hi ? "var(--p-accent-text)" : "var(--p-text)" }
  if (kind === "diamond") return base
  return {
    ...base,
    background: hi ? "var(--p-accent)" : "var(--p-surface)",
    border: `3px solid ${hi ? "var(--p-accent)" : "var(--p-border)"}`,
    borderRadius: kind === "pill" || kind === "circle" ? 9999 : "var(--p-radius)",
  }
}

export function DiagramEl({ el }: { el: ElementNode }) {
  const uid = useId().replace(/:/g, "")
  const laid = (LAYOUTS[el.type] ?? layoutFlow)(el)
  if (!laid.nodes.length) return <div style={{ color: "var(--p-muted)", fontSize: 28 }}>Empty {el.type}: add {el.type === "tree" ? "<Node>" : "<Step>"} children.</div>
  const stroke = "var(--p-muted)"
  return (
    <Fit width={laid.width} height={laid.height}>
      <svg data-edges width={laid.width} height={laid.height} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <defs>
          <marker id={`a${uid}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={stroke} />
          </marker>
        </defs>
        {laid.edges.map((e, i) => {
          const [a, b] = [e.points[0], e.points[e.points.length - 1]]
          const d = e.arc
            ? `M ${a.x} ${a.y} A ${e.arc.r} ${e.arc.r} 0 ${e.arc.large ? 1 : 0} 1 ${b.x} ${b.y}`
            : laid.elbows && e.from && e.to
              ? laid.elbows === "TB"
                ? (() => { const y1 = e.from.y + e.from.h / 2, y2 = e.to.y - e.to.h / 2, mid = (y1 + y2) / 2; return `M ${e.from.x} ${y1} V ${mid} H ${e.to.x} V ${y2}` })()
                : (() => { const x1 = e.from.x + e.from.w / 2, x2 = e.to.x - e.to.w / 2, mid = (x1 + x2) / 2; return `M ${x1} ${e.from.y} H ${mid} V ${e.to.y} H ${x2}` })()
              : curve(e.points)
          return <path key={i} d={d} fill="none" stroke={stroke} strokeWidth={4} strokeLinejoin="round" markerEnd={laid.arrows ? `url(#a${uid})` : undefined} />
        })}
        {laid.edges.map((e, i) => e.label && e.at ? (
          <g key={`l${i}`}>
            <rect x={e.at.x - (e.label.length * 26 * CHAR + 24) / 2} y={e.at.y - 20} width={e.label.length * 26 * CHAR + 24} height={40} rx={20} fill="var(--p-background)" stroke="var(--p-border)" strokeWidth={2} />
            <text x={e.at.x} y={e.at.y + 9} textAnchor="middle" fontSize={26} fill="var(--p-muted)" fontFamily="var(--p-font-body)">{e.label}</text>
          </g>
        ) : null)}
        {laid.axis && (
          <>
            <line x1={laid.axis.x1} x2={laid.axis.x2} y1={laid.axis.y} y2={laid.axis.y} stroke="var(--p-border)" strokeWidth={6} strokeLinecap="round" />
            {laid.nodes.map((n, i) => n.el.props.highlight
              ? <circle key={i} cx={n.x} cy={laid.axis!.y} r={20} fill="var(--p-accent)" stroke="color-mix(in srgb, var(--p-accent) 30%, transparent)" strokeWidth={14} />
              : <circle key={i} cx={n.x} cy={laid.axis!.y} r={14} fill="var(--p-background)" stroke="var(--p-accent)" strokeWidth={6} />)}
          </>
        )}
      </svg>
      {laid.nodes.map((n) => {
        if (laid.axis) {
          // Timeline step: date above the axis, label and note below.
          const p = n.el.props
          return (
            <div key={n.el.path} data-path={n.el.path} data-type={n.el.type} style={{ position: "absolute", left: n.x - n.w / 2, top: 0, width: n.w, height: n.h, textAlign: "center" }}>
              <div style={{ height: 48, fontSize: 30, fontWeight: 700, color: "var(--p-accent)", whiteSpace: "nowrap" }}>{p.date ? String(p.date) : ""}</div>
              <div style={{ position: "absolute", top: laid.axis.y + 44, left: 0, right: 0 }}>
                <div data-text style={{ fontSize: LABEL, fontWeight: 600, lineHeight: 1.2, textWrap: "balance" }}>{n.el.text}</div>
                {p.note ? <div style={{ fontSize: NOTE, lineHeight: 1.3, color: "var(--p-muted)", marginTop: 10 }}>{String(p.note)}</div> : null}
              </div>
            </div>
          )
        }
        const kind = n.el.props.kind
        return (
          <div key={n.el.path} data-path={n.el.path} data-type={n.el.type} data-kind={typeof kind === "string" ? kind : undefined} style={nodeStyle(n, kind)}>
            {kind === "diamond" && (
              <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0 }}>
                <polygon points="50,1 99,50 50,99 1,50" fill={n.el.props.highlight ? "var(--p-accent)" : "var(--p-surface)"} stroke={n.el.props.highlight ? "var(--p-accent)" : "var(--p-border)"} strokeWidth={3} vectorEffect="non-scaling-stroke" />
              </svg>
            )}
            <NodeBody el={n.el} kind={typeof kind === "string" ? kind : undefined} />
          </div>
        )
      })}
    </Fit>
  )
}
