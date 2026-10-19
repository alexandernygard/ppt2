import { memo } from "react"
import { SlideView } from "@ppt2/react"
import type { DeckModel } from "@ppt2/sdk"
import { useStore } from "../store"

// Every slide rendered offscreen at native resolution. Used for PDF printing,
// PPTX export (measure the DOM), and the AI's inspect tool (overflow checks
// and screenshots).
export const RenderFarm = memo(function RenderFarm() {
  const deck = useStore((s) => s.deck)
  if (!deck) return null
  return <Farm deck={deck} />
})

function Farm({ deck }: { deck: DeckModel }) {
  return (
    <div id="render-farm" aria-hidden style={{ position: "fixed", left: -100000, top: 0, pointerEvents: "none" }}>
      {deck.slides.map((s) => (
        <div key={s.index} style={{ width: deck.width, height: deck.height }}>
          <SlideView deck={deck} slide={s} />
        </div>
      ))}
    </div>
  )
}

export function farmSlide(index: number): HTMLElement | null {
  return document.querySelector(`#render-farm [data-slide-index="${index}"]`)
}

/** Wait for React to commit and the browser to lay out (and images to settle a bit). */
export async function settled(ms = 150) {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  await new Promise((r) => setTimeout(r, ms))
}
