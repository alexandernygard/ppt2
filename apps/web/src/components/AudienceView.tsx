import { useEffect, useMemo, useState } from "react"
import { compile } from "@ppt2/sdk"
import { Presenter } from "@ppt2/react"
import { channel } from "./PresentOverlay"

/** A second window that mirrors the presenter (open it on the projector). */
export function AudienceView() {
  const [source, setSource] = useState(() => localStorage.getItem("ppt2.source") ?? "")
  const [nav, setNav] = useState({ index: 0, step: 0 })
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "nav") setNav({ index: e.data.index, step: e.data.step })
      if (e.data?.type === "source") setSource(e.data.source)
      if (e.data?.type === "end") window.close()
    }
    channel?.addEventListener("message", onMsg)
    channel?.postMessage({ type: "hello" })
    return () => channel?.removeEventListener("message", onMsg)
  }, [])
  const deck = useMemo(() => compile(source).deck, [source])
  if (!deck) return <div className="grid h-full place-items-center bg-black text-white/60">Waiting for the presenter…</div>
  return <Presenter deck={deck} index={nav.index} step={nav.step} onNavigate={() => {}} passive />
}
