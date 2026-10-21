import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Yjs breaks if two copies are loaded; make sure collab and the app share one.
  resolve: { dedupe: ["yjs", "lib0", "y-protocols"] },
  // Shared decks talk to the Worker's Durable Objects; `pnpm dev:worker` serves them on :8788.
  server: { port: 5291, proxy: { "/collab": { target: "http://localhost:8788", ws: true } } },
})
