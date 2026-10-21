import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Toaster, TooltipProvider } from "@alexandernygard/components"
import "./index.css"
import { App } from "./App"
import { AudienceView } from "./components/AudienceView"
import { ErrorBoundary } from "./components/ErrorBoundary"
import { boot, joinRoom, loadCurrentAssets } from "./library"

const audience = location.hash === "#audience"

// Load the deck library (and the open deck's images) before the first render.
await (audience ? loadCurrentAssets() : boot()).catch((e) => console.error("Couldn't open the deck library", e))

// /?file=<id> opens a deck from Drive. The address keeps it while that deck is open (see App).
const file = !audience && new URLSearchParams(location.search).get("file")
if (file) await joinRoom(file, true).catch((e) => console.error("Couldn't open the Drive deck", e))

// /?room=<id> joins someone's shared deck (once; after that it is a deck in your library).
const room = !audience && new URLSearchParams(location.search).get("room")
if (room) {
  history.replaceState(null, "", location.pathname)
  await joinRoom(room).catch((e) => console.error("Couldn't open the shared deck", e))
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <ErrorBoundary>{audience ? <AudienceView /> : <App />}</ErrorBoundary>
      <Toaster position="bottom-center" />
    </TooltipProvider>
  </StrictMode>,
)
