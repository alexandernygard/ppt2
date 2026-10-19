import { useEffect, useRef } from "react"
import { Presenter } from "@ppt2/react"
import { useStore } from "../store"

// Sync between the presenter window and an optional audience window.
export const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("ppt2-present") : undefined

export function PresentOverlay() {
  const presenting = useStore((s) => s.presenting)
  const deck = useStore((s) => s.deck)
  const source = useStore((s) => s.source)
  const audience = useRef<Window | null>(null)

  useEffect(() => {
    if (presenting) channel?.postMessage({ type: "nav", index: presenting.index, step: presenting.step })
  }, [presenting?.index, presenting?.step])
  useEffect(() => {
    channel?.postMessage({ type: "source", source })
  }, [source])
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "hello") {
        channel?.postMessage({ type: "source", source: useStore.getState().source })
        const p = useStore.getState().presenting
        if (p) channel?.postMessage({ type: "nav", index: p.index, step: p.step })
      }
    }
    channel?.addEventListener("message", onMsg)
    return () => channel?.removeEventListener("message", onMsg)
  }, [])

  if (!presenting || !deck) return null
  const exit = () => {
    const i = useStore.getState().presenting?.index ?? 0
    useStore.setState({ presenting: null, current: i })
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    channel?.postMessage({ type: "end" })
  }
  return (
    <>
      <Presenter
        deck={deck}
        index={presenting.index}
        step={presenting.step}
        speaker={presenting.speaker}
        onNavigate={(index, step) => useStore.setState({ presenting: { ...presenting, index, step } })}
        onExit={exit}
      />
      {presenting.speaker && (
        <button
          className="fixed right-6 bottom-6 z-[1001] rounded-md bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20"
          onClick={() => { audience.current = window.open(`${location.pathname}#audience`, "ppt2-audience", "popup,width=1280,height=720") }}
        >
          Open audience window
        </button>
      )}
    </>
  )
}
