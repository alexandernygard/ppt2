import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Toaster, TooltipProvider } from "@alexandernygard/components"
import "./index.css"
import { App } from "./App"
import { AudienceView } from "./components/AudienceView"
import { ErrorBoundary } from "./components/ErrorBoundary"
import { boot, loadCurrentAssets } from "./library"

const audience = location.hash === "#audience"

// Load the deck library (and the open deck's images) before the first render.
await (audience ? loadCurrentAssets() : boot()).catch((e) => console.error("Couldn't open the deck library", e))

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <ErrorBoundary>{audience ? <AudienceView /> : <App />}</ErrorBoundary>
      <Toaster position="bottom-center" />
    </TooltipProvider>
  </StrictMode>,
)
