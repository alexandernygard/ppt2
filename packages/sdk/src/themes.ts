import type { Theme, ThemeInput } from "./types"

const mono = "'JetBrains Mono', ui-monospace, monospace"

export const themes: Record<string, Theme> = {
  snow: {
    name: "snow",
    label: "Snow",
    dark: false,
    colors: {
      background: "#f5f7f8",
      surface: "#ffffff",
      text: "#18212b",
      muted: "#5b6875",
      accent: "#f2a922",
      accentText: "#18212b",
      border: "#dde3e8",
      inverseBackground: "#18212b",
      inverseText: "#f5f7f8",
      chart: ["#18212b", "#f2a922", "#5b8db8", "#3fa36b", "#c4553d"],
    },
    fonts: { heading: "Libron, 'Inter', sans-serif", body: "Libron, 'Inter', sans-serif", mono },
    headingWeight: 600,
    headingTracking: -0.02,
    radius: 16,
    backdrop: "none",
  },
  midnight: {
    name: "midnight",
    label: "Midnight",
    dark: true,
    colors: {
      background: "#0b1020",
      surface: "#141a2e",
      text: "#eef1f8",
      muted: "#98a2bd",
      accent: "#5eead4",
      accentText: "#0b1020",
      border: "#252d47",
      inverseBackground: "#eef1f8",
      inverseText: "#0b1020",
      chart: ["#5eead4", "#818cf8", "#f472b6", "#fbbf24", "#60a5fa"],
    },
    fonts: { heading: "'Space Grotesk', sans-serif", body: "'Inter', sans-serif", mono },
    headingWeight: 600,
    headingTracking: -0.03,
    radius: 20,
    backdrop: "glow",
  },
  paper: {
    name: "paper",
    label: "Paper",
    dark: false,
    colors: {
      background: "#f6f1e7",
      surface: "#fffaf0",
      text: "#2b2118",
      muted: "#7a6a58",
      accent: "#b4532a",
      accentText: "#fffaf0",
      border: "#e3d8c5",
      inverseBackground: "#2b2118",
      inverseText: "#f6f1e7",
      chart: ["#b4532a", "#2b2118", "#6f8f72", "#d6a243", "#8a6fa8"],
    },
    fonts: { heading: "'Fraunces', Georgia, serif", body: "'Inter', sans-serif", mono },
    headingWeight: 500,
    headingTracking: -0.01,
    radius: 6,
    backdrop: "none",
  },
  aurora: {
    name: "aurora",
    label: "Aurora",
    dark: true,
    colors: {
      background: "#06140f",
      surface: "#0e2219",
      text: "#ecfdf5",
      muted: "#8fb5a3",
      accent: "#a3e635",
      accentText: "#06140f",
      border: "#1c3a2c",
      inverseBackground: "#ecfdf5",
      inverseText: "#06140f",
      chart: ["#a3e635", "#34d399", "#22d3ee", "#c084fc", "#facc15"],
    },
    fonts: { heading: "'Space Grotesk', sans-serif", body: "'Inter', sans-serif", mono },
    headingWeight: 700,
    headingTracking: -0.035,
    radius: 24,
    backdrop: "gradient",
  },
  mono: {
    name: "mono",
    label: "Mono",
    dark: false,
    colors: {
      background: "#ffffff",
      surface: "#f4f4f5",
      text: "#09090b",
      muted: "#71717a",
      accent: "#09090b",
      accentText: "#ffffff",
      border: "#e4e4e7",
      inverseBackground: "#09090b",
      inverseText: "#ffffff",
      chart: ["#09090b", "#52525b", "#a1a1aa", "#d4d4d8", "#27272a"],
    },
    fonts: { heading: "'Inter', sans-serif", body: "'Inter', sans-serif", mono },
    headingWeight: 700,
    headingTracking: -0.04,
    radius: 0,
    backdrop: "grid",
  },
  sunset: {
    name: "sunset",
    label: "Sunset",
    dark: false,
    colors: {
      background: "#fff4ec",
      surface: "#ffffff",
      text: "#3b0d1f",
      muted: "#8c5a64",
      accent: "#f43f5e",
      accentText: "#ffffff",
      border: "#f7d9cc",
      inverseBackground: "#3b0d1f",
      inverseText: "#fff4ec",
      chart: ["#f43f5e", "#fb923c", "#3b0d1f", "#facc15", "#a855f7"],
    },
    fonts: { heading: "'Instrument Serif', Georgia, serif", body: "'DM Sans', sans-serif", mono },
    headingWeight: 400,
    headingTracking: -0.01,
    radius: 28,
    backdrop: "gradient",
  },
}

export function resolveTheme(input: ThemeInput | undefined): { theme: Theme; warning?: string } {
  if (input == null) return { theme: themes.snow }
  if (typeof input === "string") {
    const t = themes[input]
    return t ? { theme: t } : { theme: themes.snow, warning: `Unknown theme "${input}". Built-in themes: ${Object.keys(themes).join(", ")}` }
  }
  const base = themes[input.base ?? "snow"] ?? themes.snow
  return {
    theme: {
      ...base,
      ...input,
      name: input.name ?? `${base.name}+custom`,
      colors: { ...base.colors, ...input.colors },
      fonts: { ...base.fonts, ...input.fonts },
    } as Theme,
  }
}

/** Font families the themes use from Google Fonts. */
export const GOOGLE_FONTS = ["Inter:wght@400;500;600;700", "Space Grotesk:wght@400;500;600;700", "Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600", "JetBrains Mono:wght@400;600", "Instrument Serif", "DM Sans:wght@400;500;700"]
