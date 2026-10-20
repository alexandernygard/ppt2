// PPTX export by "render, then measure": slides are laid out by the browser
// (the same renderer as the canvas), then each element's measured box and
// computed style is mapped to a native PowerPoint object. Charts become
// native, editable PowerPoint charts.

import PptxGenJS from "pptxgenjs"
import type { DeckModel, ElementNode } from "@ppt2/sdk"
import { brandOf } from "./SlideView"

const IN_PER_UNIT = 7.5 / 1080

function toHex(css: string): { hex: string; alpha: number } | undefined {
  let m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?/.exec(css)
  if (m) return { hex: [m[1], m[2], m[3]].map((v) => Math.round(+v).toString(16).padStart(2, "0")).join(""), alpha: m[4] != null ? +m[4] : 1 }
  m = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?/.exec(css)
  if (m) return { hex: [m[1], m[2], m[3]].map((v) => Math.round(+v * 255).toString(16).padStart(2, "0")).join(""), alpha: m[4] != null ? +m[4] : 1 }
}
const hex = (css: string, fallback = "000000") => toHex(css)?.hex ?? fallback
const plain = (s: string) => s.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/==([^=]+)==/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
const family = (ff: string) => ff.split(",")[0].replace(/["']/g, "").trim()

/** Serialize a rendered <svg> to a data URL with CSS variables and currentColor resolved. */
function svgDataUrl(svg: SVGSVGElement, w: number, h: number): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  const src = [svg, ...svg.querySelectorAll("*")]
  const dst = [clone, ...clone.querySelectorAll("*")]
  src.forEach((n, i) => {
    const cs = getComputedStyle(n)
    const d = dst[i] as SVGElement
    for (const prop of ["fill", "stroke", "stroke-width", "opacity", "font-size", "font-family"]) {
      const v = cs.getPropertyValue(prop)
      if (v && v !== "none" || prop === "fill" || prop === "stroke") d.setAttribute(prop, v || "none")
    }
  })
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg")
  clone.setAttribute("width", String(w))
  clone.setAttribute("height", String(h))
  if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", `0 0 ${svg.width.baseVal.value || w} ${svg.height.baseVal.value || h}`)
  clone.removeAttribute("style")
  return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(clone))))
}

/** Draw an image as it appears in its frame (fit, focus, zoom), so crops survive export exactly. */
function croppedImage(img: HTMLImageElement, frame: HTMLElement, p: Record<string, unknown>): string | undefined {
  try {
    const fw = frame.offsetWidth, fh = frame.offsetHeight
    const nw = img.naturalWidth, nh = img.naturalHeight
    if (!fw || !fh || !nw) return
    const px = Math.min(2, 2400 / Math.max(fw, fh))
    const c = document.createElement("canvas")
    c.width = Math.round(fw * px); c.height = Math.round(fh * px)
    const ctx = c.getContext("2d")!
    const m = typeof p.focus === "string" ? /([\d.]+)%\s+([\d.]+)%/.exec(p.focus) : null
    const fx = m ? +m[1] / 100 : 0.5, fy = m ? +m[2] / 100 : 0.5
    const z = typeof p.zoom === "number" ? p.zoom : 1
    const k = (p.fit === "contain" ? Math.min(fw / nw, fh / nh) : Math.max(fw / nw, fh / nh))
    const dw = nw * k, dh = nh * k
    const dx = (fw - dw) * fx, dy = (fh - dh) * fy
    const ox = fw * fx, oy = fh * fy
    ctx.scale(px, px)
    ctx.drawImage(img, ox + z * (dx - ox), oy + z * (dy - oy), dw * z, dh * z)
    return c.toDataURL(p.fit === "contain" ? "image/png" : "image/jpeg", 0.92)
  } catch { return undefined } // tainted canvas: fall back to the uncropped image
}

/** Rasterize a logo at its rendered size (SVGs included), so PowerPoint shows it exactly as on the canvas. */
function logoPng(img: HTMLImageElement): string | undefined {
  try {
    const w = img.offsetWidth, h = img.offsetHeight
    if (!w || !h) return
    const c = document.createElement("canvas")
    const k = Math.min(4, 2000 / w)
    c.width = Math.round(w * k); c.height = Math.round(h * k)
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL("image/png")
  } catch { return undefined }
}

async function toDataUrl(src: string): Promise<string | undefined> {
  try {
    const res = await fetch(src, { mode: "cors" })
    const blob = await res.blob()
    return await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result as string); fr.readAsDataURL(blob) })
  } catch { return undefined }
}

export async function exportPptx(deck: DeckModel, getSlideRoot: (index: number) => HTMLElement | null, fileName = "deck.pptx") {
  const pptx = new PptxGenJS()
  const wIn = deck.width * IN_PER_UNIT
  pptx.defineLayout({ name: "PPT2", width: wIn, height: 7.5 })
  pptx.layout = "PPT2"
  pptx.title = deck.title
  // Brand fonts must be loaded before measuring, or text boxes get the fallback font's metrics.
  await document.fonts?.ready

  for (const slide of deck.slides) {
    const root = getSlideRoot(slide.index)
    const s = pptx.addSlide()
    if (slide.notes) s.addNotes(slide.notes)
    if (!root) continue
    const rootCs = getComputedStyle(root)
    s.background = { color: hex(rootCs.backgroundColor, "FFFFFF") }
    const bg = slide.props.background
    if (typeof bg === "string" && /^(https?:|data:)/.test(bg)) {
      const data = await toDataUrl(bg)
      if (data) s.addImage({ data, x: 0, y: 0, w: wIn, h: 7.5, sizing: { type: "cover", w: wIn, h: 7.5 } })
    }
    const a = root.getBoundingClientRect()
    const scale = a.width / deck.width
    const boxOf = (node: Element) => {
      const b = node.getBoundingClientRect()
      return { x: ((b.left - a.left) / scale) * IN_PER_UNIT, y: ((b.top - a.top) / scale) * IN_PER_UNIT, w: (b.width / scale) * IN_PER_UNIT, h: (b.height / scale) * IN_PER_UNIT }
    }

    const visit = async (el: ElementNode) => {
      const node = root.querySelector(`[data-path="${el.path}"]`) as HTMLElement | null
      if (!node) return
      const box = boxOf(node)
      const cs = getComputedStyle(node)
      const textNode = (node.querySelector("h1,h2,blockquote,p,ul,div") as HTMLElement) ?? node
      const tcs = getComputedStyle(textNode)
      const base = {
        ...box,
        fontFace: family(tcs.fontFamily),
        fontSize: Math.max(6, parseFloat(tcs.fontSize) * 0.5),
        color: hex(cs.color),
        align: (["left", "center", "right"].includes(tcs.textAlign) ? tcs.textAlign : "left") as "left" | "center" | "right",
        valign: "top" as const,
        margin: 0,
        fit: "shrink" as const,
      }
      const p = el.props
      switch (el.type) {
        case "row": case "column": case "card":
          if (el.type === "card") s.addShape(pptx.ShapeType.roundRect, { ...box, fill: { color: hex(getComputedStyle(node.firstElementChild!).backgroundColor, "FFFFFF") }, line: { color: hex(getComputedStyle(node.firstElementChild!).borderTopColor, "DDDDDD"), width: 1 }, rectRadius: 0.1 })
          for (const c of el.children ?? []) await visit(c)
          return
        case "title": case "subtitle": case "quote":
          s.addText(plain(el.text ?? "") + (el.type === "quote" && p.by ? `\n— ${p.by}` : ""), { ...base, bold: parseInt(tcs.fontWeight) >= 600 })
          return
        case "text": {
          const runs = (el.text ?? "").split("\n").filter((l) => l.trim()).map((l) => {
            const b = /^\s*[-*•]\s+(.*)$/.exec(l)
            return { text: plain(b ? b[1] : l), options: { bullet: !!b, breakLine: true } }
          })
          s.addText(runs, base)
          return
        }
        case "list":
          s.addText(((p.items as string[]) ?? []).map((t) => ({ text: plain(t), options: { bullet: p.ordered ? { type: "number" as const } : true, breakLine: true } })), { ...base, fontSize: parseFloat(getComputedStyle(node.querySelector("li") ?? node).fontSize) * 0.5, paraSpaceAfter: 8 })
          return
        case "code":
          s.addText(el.text ?? "", { ...base, fontFace: "Courier New", fill: { color: hex(getComputedStyle(node.firstElementChild!).backgroundColor, "F4F4F5") }, margin: 12 })
          return
        case "stat":
          s.addText([
            { text: String(p.value ?? ""), options: { fontSize: base.fontSize * 2.5, bold: true, breakLine: true } },
            ...(p.label ? [{ text: String(p.label), options: { fontSize: 17, color: hex(rootCs.getPropertyValue("--p-muted")) || "777777", breakLine: true } }] : []),
            ...(p.delta ? [{ text: String(p.delta), options: { fontSize: 15, color: hex(getComputedStyle(node).getPropertyValue("--p-accent")), bold: true } }] : []),
          ], { ...base, fontSize: parseFloat(getComputedStyle(node.firstElementChild!.firstElementChild!).fontSize) * 0.5 / 2.5 })
          return
        case "image": {
          const img = node.querySelector("img")
          const frame = node.querySelector("[data-frame]") as HTMLElement | null
          if (!img || !frame) return
          const fb = boxOf(frame)
          const cropped = croppedImage(img, frame, p)
          if (cropped) { s.addImage({ data: cropped, ...fb }); return }
          const data = await toDataUrl(img.currentSrc || img.src)
          if (data) s.addImage({ data, ...fb, sizing: { type: p.fit === "contain" ? "contain" : "cover", w: fb.w, h: fb.h } })
          return
        }
        case "icon": {
          const svg = node.querySelector("svg")
          if (svg) { const ib = boxOf(svg); s.addImage({ data: svgDataUrl(svg, svg.getBoundingClientRect().width / scale, svg.getBoundingClientRect().height / scale), ...ib }) }
          return
        }
        case "flow": case "tree": case "timeline": case "cycle": {
          // Connectors as one vector image underneath, nodes as native, editable shapes on top.
          const svg = node.querySelector("svg[data-edges]") as SVGSVGElement | null
          if (svg) s.addImage({ data: svgDataUrl(svg, svg.width.baseVal.value, svg.height.baseVal.value), ...boxOf(svg) })
          node.querySelectorAll<HTMLElement>("[data-type=step], [data-type=node]").forEach((n) => {
            const b = boxOf(n)
            const ncs = getComputedStyle(n)
            const kind = n.dataset.kind
            const timeline = el.type === "timeline"
            const texts = [...n.querySelectorAll<HTMLElement>(timeline ? "div > div" : "[data-text], [data-text] ~ div")].filter((t) => t.childElementCount === 0 && t.textContent?.trim())
            const diamond = n.querySelector("polygon")
            const fill = diamond ? getComputedStyle(diamond).fill : ncs.backgroundColor
            const border = diamond ? getComputedStyle(diamond).stroke : ncs.borderTopColor
            if (!timeline) {
              const shape = kind === "diamond" ? pptx.ShapeType.diamond : kind === "circle" ? pptx.ShapeType.ellipse : pptx.ShapeType.roundRect
              s.addShape(shape, { ...b, fill: toHex(fill) ? { color: hex(fill) } : undefined, line: { color: hex(border, "DDDDDD"), width: 1.5 }, rectRadius: kind === "pill" ? 0.5 : 0.08 })
            }
            const runs = texts.map((t, i) => {
              const tcs = getComputedStyle(t)
              const fsz = parseFloat(tcs.fontSize) * 0.5 * (b.w / Math.max(1, n.offsetWidth * IN_PER_UNIT))
              return { text: t.textContent!.trim(), options: { fontSize: Math.max(6, fsz), bold: parseInt(tcs.fontWeight) >= 600, color: hex(tcs.color), breakLine: i < texts.length - 1, fontFace: family(tcs.fontFamily) } }
            })
            if (runs.length) s.addText(runs, { ...b, align: "center", valign: timeline ? "top" : "middle", margin: 4, fit: "shrink" })
          })
          return
        }
        case "shape": {
          const shapeEl = node.querySelector("rect,ellipse,polygon,line") as SVGElement | null
          const scs = shapeEl ? getComputedStyle(shapeEl) : undefined
          const kind = (p.kind as string) ?? "rect"
          const fill = scs && scs.fill !== "none" ? toHex(scs.fill) : undefined
          const opacity = parseFloat(cs.opacity || "1")
          const type = kind === "ellipse" ? pptx.ShapeType.ellipse : kind === "triangle" ? pptx.ShapeType.triangle : kind === "line" || kind === "arrow" ? pptx.ShapeType.line : p.radius ? pptx.ShapeType.roundRect : pptx.ShapeType.rect
          const line = kind === "line" || kind === "arrow" ? { y: box.y + box.h / 2, h: 0 } : {}
          s.addShape(type, {
            ...box, ...line,
            fill: fill ? { color: fill.hex, transparency: Math.round((1 - fill.alpha * opacity) * 100) } : undefined,
            line: scs && scs.stroke !== "none" ? { color: hex(scs.stroke), width: parseFloat(scs.strokeWidth) * 0.5, endArrowType: kind === "arrow" ? "triangle" : undefined } : undefined,
            rotate: (p.rotate as number) ?? 0,
          })
          if (el.text) s.addText(el.text, { ...base, align: "center", valign: "middle", color: hex(getComputedStyle(node.querySelector("svg + div") ?? node).color) })
          return
        }
        case "chart": {
          const data = (p.data as Record<string, unknown>[]) ?? []
          const series = (Array.isArray(p.series) ? p.series : [p.series]) as string[]
          const t = (p.type as string) ?? "bar"
          const type = t === "line" ? pptx.ChartType.line : t === "area" ? pptx.ChartType.area : t === "pie" ? pptx.ChartType.pie : t === "donut" ? pptx.ChartType.doughnut : pptx.ChartType.bar
          const cats = data.map((r) => String(r[String(p.category)]))
          const chartData = (t === "pie" || t === "donut" ? series.slice(0, 1) : series).map((name) => ({ name, labels: cats, values: data.map((r) => Number(r[name]) || 0) }))
          const muted = hex(rootCs.getPropertyValue("--p-muted").trim() || "#777")
          const text = hex(rootCs.color)
          s.addChart(type, chartData, {
            ...box,
            chartColors: deck.theme.colors.chart.map((c) => c.replace("#", "")),
            barDir: p.horizontal ? "bar" : "col",
            barGrouping: p.stacked ? "stacked" : "clustered",
            showLegend: series.length > 1 || !!p.legend || t === "pie" || t === "donut",
            legendPos: "b",
            legendFontSize: 14,
            legendColor: text,
            catAxisLabelColor: muted,
            valAxisLabelColor: muted,
            catAxisLabelFontSize: 13,
            valAxisLabelFontSize: 13,
            valGridLine: { color: hex(rootCs.getPropertyValue("--p-border").trim() || "#ddd"), size: 1 },
            catGridLine: { style: "none" },
            showValue: !!p.labels,
            holeSize: 55,
          })
          return
        }
        case "table": {
          const columns = (p.columns as string[]) ?? []
          const rows = (p.rows as (string | number)[][]) ?? []
          const cell = (v: unknown, header = false) => ({ text: String(v), options: { bold: header, color: header ? hex(rootCs.getPropertyValue("--p-muted").trim() || "#777") : base.color } })
          s.addTable([...(columns.length ? [columns.map((c) => cell(c, true))] : []), ...rows.map((r) => r.map((c) => cell(c)))], { ...box, fontFace: base.fontFace, fontSize: base.fontSize * 0.9, border: { type: "solid", pt: 0.5, color: hex(rootCs.getPropertyValue("--p-border").trim() || "#ddd") } })
          return
        }
      }
    }
    const brand = brandOf(deck, slide)
    for (const el of [...brand.behind, ...slide.elements.filter((e) => e.props.x == null && e.props.y == null)]) await visit(el)
    // Logo, footer and slide number sit above the flow, below free-floating elements (as on the canvas).
    for (const n of root.querySelectorAll<HTMLElement>("[data-chrome]")) {
      const b = boxOf(n)
      if (n instanceof HTMLImageElement) {
        const data = logoPng(n) ?? await toDataUrl(n.currentSrc || n.src)
        if (data) s.addImage({ data, ...b })
        continue
      }
      const ncs = getComputedStyle(n)
      const right = n.closest<HTMLElement>("[data-chrome-layer] > div")?.style.right !== ""
      // Pad the box: PowerPoint's text metrics differ slightly from the browser's.
      s.addText(n.textContent ?? "", { x: right ? b.x - 1 : b.x, y: b.y - 0.05, w: b.w + 1, h: b.h + 0.1, margin: 0, valign: "middle", align: right ? "right" : "left", fontFace: family(ncs.fontFamily), fontSize: parseFloat(ncs.fontSize) * 0.5, color: hex(ncs.color, "777777") })
    }
    for (const el of slide.elements.filter((e) => e.props.x != null || e.props.y != null)) await visit(el)
  }
  await pptx.writeFile({ fileName })
}
