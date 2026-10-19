// Rendered-layout checks: things only visible after layout, like overflow.
// Feeds the AI a "what does it actually look like" signal.

import type { Diagnostic } from "@ppt2/sdk"

export function inspectSlideElement(root: HTMLElement, slideIndex: number): Diagnostic[] {
  const out: Diagnostic[] = []
  const label = `Slide ${slideIndex + 1}`
  const W = root.offsetWidth, H = root.offsetHeight
  root.querySelectorAll<HTMLElement>("[data-slot-name]").forEach((slot) => {
    // Slots that allow overflow (titles) only spill glyph descenders; real overflow is clipped content.
    if (getComputedStyle(slot).overflow !== "visible" && slot.scrollHeight > slot.clientHeight + 8) {
      out.push({ severity: "warning", slide: slideIndex, message: `${label}: content overflows the "${slot.dataset.slotName}" area by ${slot.scrollHeight - slot.clientHeight}px — cut text, split the slide, or use a smaller size` })
    }
  })
  root.querySelectorAll<HTMLElement>("[data-path]").forEach((el) => {
    const left = el.offsetLeft, top = el.offsetTop
    if (el.style.position === "absolute" && (left + el.offsetWidth > W + 2 || top + el.offsetHeight > H + 2 || left < -el.offsetWidth / 2 || top < -el.offsetHeight / 2)) {
      out.push({ severity: "info", slide: slideIndex, path: el.dataset.path, message: `${label}: ${el.dataset.type} at ${el.dataset.path} extends past the slide edge` })
    }
    const text = el.querySelector("h1,h2,blockquote") as HTMLElement | null
    if (text && text.scrollWidth > text.clientWidth + 4) {
      out.push({ severity: "warning", slide: slideIndex, path: el.dataset.path, message: `${label}: a word in the ${el.dataset.type} is too long for its box` })
    }
  })
  return out
}
