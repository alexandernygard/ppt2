import { Fragment, type ReactNode } from "react"

// Markdown-lite for slide text: paragraphs, "- " bullets, **bold**, *italic*,
// `code`, ==highlight== and [links](url). Deliberately small.

const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|==[^=]+==|\[[^\]]+\]\([^)]+\))/g

export function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (!part) return null
    if (part.startsWith("**")) return <strong key={i} style={{ fontWeight: 700 }}>{part.slice(2, -2)}</strong>
    if (part.startsWith("==")) return <mark key={i} style={{ background: "color-mix(in srgb, var(--p-accent) 35%, transparent)", color: "inherit", padding: "0 0.15em", borderRadius: 4 }}>{part.slice(2, -2)}</mark>
    if (part.startsWith("`")) return <code key={i} style={{ fontFamily: "var(--p-font-mono)", fontSize: "0.85em", background: "color-mix(in srgb, var(--p-text) 8%, transparent)", padding: "0.05em 0.3em", borderRadius: 6 }}>{part.slice(1, -1)}</code>
    if (part.startsWith("[")) {
      const m = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
      if (m) return <a key={i} href={m[2]} target="_blank" rel="noreferrer" style={{ color: "var(--p-accent)", textDecoration: "underline" }}>{m[1]}</a>
    }
    if (part.startsWith("*") && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>
    return <Fragment key={i}>{part}</Fragment>
  })
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  const lines = text.split("\n")
  let bullets: string[] = []
  let para: string[] = []
  const flushPara = () => {
    if (para.length) blocks.push(<p key={blocks.length} style={{ margin: 0 }}>{para.map((l, i) => <Fragment key={i}>{i > 0 && <br />}{inline(l)}</Fragment>)}</p>)
    para = []
  }
  const flushBullets = () => {
    if (bullets.length) blocks.push(<BulletList key={blocks.length} items={bullets} />)
    bullets = []
  }
  for (const line of lines) {
    const m = /^\s*[-*•]\s+(.*)$/.exec(line)
    if (m) { flushPara(); bullets.push(m[1]) }
    else if (!line.trim()) { flushPara(); flushBullets() }
    else { flushBullets(); para.push(line) }
  }
  flushPara()
  flushBullets()
  return <div style={{ display: "flex", flexDirection: "column", gap: "0.6em" }}>{blocks}</div>
}

export function BulletList({ items, ordered }: { items: string[]; ordered?: boolean }) {
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "0.55em" }}>
      {items.map((item, i) => (
        <li key={i} style={{ display: "flex", gap: "0.7em", alignItems: "baseline" }}>
          <span aria-hidden style={{ color: "var(--p-accent)", fontWeight: 700, minWidth: ordered ? "1.4em" : undefined, flexShrink: 0 }}>
            {ordered ? `${i + 1}.` : <span style={{ display: "inline-block", width: "0.38em", height: "0.38em", borderRadius: 99, background: "var(--p-accent)", transform: "translateY(-0.12em)" }} />}
          </span>
          <span>{inline(item)}</span>
        </li>
      ))}
    </ul>
  )
}
