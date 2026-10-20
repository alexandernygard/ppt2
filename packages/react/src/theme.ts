import type { CSSProperties } from "react"
import type { SlideNode, Theme } from "@ppt2/sdk"
import { isAssetRef, resolveSrc } from "./assets"

const TOKENS = new Set(["accent", "muted", "text", "surface", "background", "border", "accentText"])

/** Resolve a color prop: theme tokens become CSS variables, anything else passes through. */
export function color(c: unknown): string | undefined {
  if (typeof c !== "string" || !c) return undefined
  if (TOKENS.has(c)) return `var(--p-${c === "accentText" ? "accent-text" : c})`
  if (/^chart-?\d$/.test(c)) return `var(--p-chart-${c.replace(/\D/g, "")})`
  return c
}

export const SIZES: Record<string, number> = { xs: 24, sm: 30, md: 38, lg: 48, xl: 64, "2xl": 88, "3xl": 120, "4xl": 180 }

export function fontSize(size: unknown, fallback: number): number {
  if (typeof size === "number") return size
  if (typeof size === "string" && SIZES[size]) return SIZES[size]
  return fallback
}

export function themeVars(theme: Theme): CSSProperties {
  const c = theme.colors
  const vars: Record<string, string | number> = {
    "--p-background": c.background,
    "--p-surface": c.surface,
    "--p-text": c.text,
    "--p-muted": c.muted,
    "--p-accent": c.accent,
    "--p-accent-text": c.accentText,
    "--p-border": c.border,
    "--p-inverse-bg": c.inverseBackground,
    "--p-inverse-text": c.inverseText,
    "--p-font-heading": theme.fonts.heading,
    "--p-font-body": theme.fonts.body,
    "--p-font-mono": theme.fonts.mono,
    "--p-heading-weight": theme.headingWeight,
    "--p-heading-tracking": `${theme.headingTracking}em`,
    "--p-radius": `${theme.radius}px`,
  }
  c.chart.forEach((v, i) => (vars[`--p-chart-${i + 1}`] = v))
  return vars as CSSProperties
}

/** Slide-level variant + background, layered over the theme. */
export function slideStyle(theme: Theme, slide: SlideNode): CSSProperties {
  const variant = slide.props.variant
  const style: Record<string, string> = {}
  // Use literal colors: variables that reference each other on one element resolve circularly.
  const c = theme.colors
  const mix = (fg: string, pct: number, bg: string) => `color-mix(in srgb, ${fg} ${pct}%, ${bg})`
  if (variant === "inverse" || variant === "accent") {
    const bg = variant === "inverse" ? c.inverseBackground : c.accent
    const fg = variant === "inverse" ? c.inverseText : c.accentText
    style["--p-background"] = bg
    style["--p-text"] = fg
    style["--p-surface"] = mix(fg, 8, bg)
    style["--p-border"] = mix(fg, 18, "transparent")
    style["--p-muted"] = mix(fg, 68, "transparent")
    if (variant === "accent") { style["--p-accent"] = fg; style["--p-accent-text"] = bg }
  }

  const layers: string[] = []
  const bg = slide.props.background
  let base = "var(--p-background)"
  if (typeof bg === "string" && bg) {
    if (isAssetRef(bg)) layers.push(`center / cover no-repeat url("${resolveSrc(bg)}")`)
    else if (/^(https?:|\/|data:|blob:)/.test(bg)) layers.push(`center / cover no-repeat url("${bg}")`)
    else if (bg.includes("gradient(")) layers.push(bg)
    else base = color(bg) ?? bg
  }
  if (!variant || variant === "default") {
    if (theme.backdrop === "glow") layers.push("radial-gradient(1100px 700px at 100% 0%, color-mix(in srgb, var(--p-accent) 16%, transparent), transparent 70%)")
    if (theme.backdrop === "gradient") layers.push("linear-gradient(135deg, color-mix(in srgb, var(--p-accent) 10%, transparent), transparent 55%)")
    if (theme.backdrop === "grid") layers.push("linear-gradient(var(--p-border) 1px, transparent 1px) 0 0 / 80px 80px, linear-gradient(90deg, var(--p-border) 1px, transparent 1px) 0 0 / 80px 80px")
  }
  style.background = [...layers, base].join(", ")
  return style as CSSProperties
}
