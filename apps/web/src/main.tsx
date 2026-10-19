import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Toaster, TooltipProvider } from "@alexandernygard/components"
import "./index.css"
import { App } from "./App"
import { AudienceView } from "./components/AudienceView"

const audience = location.hash === "#audience"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      {audience ? <AudienceView /> : <App />}
      <Toaster position="bottom-center" />
    </TooltipProvider>
  </StrictMode>,
)
