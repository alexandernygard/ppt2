import { memo, useMemo } from "react"
import { FixedStage, SlideView } from "@ppt2/react"
import { compile } from "@ppt2/sdk"

export function ago(t: number) {
  const s = (Date.now() - t) / 1000
  if (s < 45) return "just now"
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  if (s < 7 * 86400) return `${Math.round(s / 86400)} d ago`
  return new Date(t).toLocaleDateString()
}

/** A slide of a deck that isn't the open one, compiled from its source. */
export const DeckThumb = memo(function DeckThumb({ source, slide = 0, className }: { source: string; slide?: number; className?: string }) {
  const deck = useMemo(() => compile(source).deck, [source])
  const s = deck?.slides[slide]
  if (!deck || !s) return <div className={className} style={{ aspectRatio: "16 / 9" }}><div className="grid h-full place-items-center rounded-md bg-muted text-xs text-muted-foreground">{deck ? "No slides" : "Doesn't compile"}</div></div>
  return (
    <div className={className}>
      <FixedStage width={deck.width} height={deck.height} className="pointer-events-none overflow-hidden rounded-md">
        <SlideView deck={deck} slide={s} />
      </FixedStage>
    </div>
  )
})
