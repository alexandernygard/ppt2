import { describe, expect, it } from "vitest"
import { compile } from "./compile"
import { setProps, setThemeProps, setText, moveSlide, insertSlide, removeSlide, duplicateSlide, insertElement, removeElement, applyEdits, PatchError, elementCode, replaceSlide, moveElement, defineComponent, componentFromElement, renameComponent, removeComponent, componentName } from "./patch"
import { STARTER_DECK } from "./starter"
import { lintDeck, outline, assetRefs } from "./outline"

const SRC = `import { Deck, Slide, Title, Text, List } from "ppt2"

// a comment that must survive
const items = ["a", "b"]

export default (
  <Deck title="Test" theme="paper">
    <Slide layout="title">
      <Title>Hello</Title>
      <Text>
        First line
        - bullet
      </Text>
    </Slide>
    <Slide>
      <Title size="lg">Second</Title>
      <List items={items} />
      {/* notes below */}
      <Text x={10} y={20}>Pinned</Text>
    </Slide>
    <Slide id="third" layout="statement">
      <Title>Third</Title>
    </Slide>
  </Deck>
)
`

const must = (src: string) => {
  const r = compile(src)
  if (!r.deck) throw new Error(r.errors.map((e) => e.message).join("\n"))
  return r.deck
}

describe("compile", () => {
  it("builds the deck model with source offsets", () => {
    const deck = must(SRC)
    expect(deck.title).toBe("Test")
    expect(deck.theme.name).toBe("paper")
    expect(deck.slides).toHaveLength(3)
    expect(deck.slides[0].elements[0]).toMatchObject({ type: "title", text: "Hello", path: "0/0" })
    expect(SRC.slice(deck.slides[0].src!, deck.slides[0].src! + 6)).toBe("<Slide")
  })

  it("keeps line breaks in text children, dedented", () => {
    const deck = must(SRC)
    expect(deck.slides[0].elements[1].text).toBe("First line\n- bullet")
  })

  it("evaluates code: variables, map and csv", () => {
    const deck = must(`import { Deck, Slide, Title, Chart, csv } from "ppt2"
const rows = csv\`k,v\nA,1\nB,2\`
export default <Deck>{["x", "y"].map((t) => <Slide><Title>{t}</Title><Chart data={rows} category="k" series="v" /></Slide>)}</Deck>`)
    expect(deck.slides.map((s) => s.elements[0].text)).toEqual(["x", "y"])
    expect(deck.slides[0].elements[1].props.data).toEqual([{ k: "A", v: 1 }, { k: "B", v: 2 }])
  })

  it("reports syntax errors with a location", () => {
    const r = compile(`export default <Deck><Slide></Deck>`)
    expect(r.deck).toBeUndefined()
    expect(r.errors[0].line).toBe(1)
  })

  it("warns about unknown layouts and themes without failing", () => {
    const r = compile(`export default <Deck theme="nope"><Slide layout="weird"><Title>x</Title></Slide></Deck>`)
    expect(r.deck?.slides[0].layout).toBe("content")
    expect(r.warnings.length).toBe(2)
  })

  it("compiles the starter deck cleanly", () => {
    const r = compile(STARTER_DECK)
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r.deck!.slides.length).toBeGreaterThan(4)
    expect(outline(r.deck!)).toContain("Slide 1 [title]")
    expect(lintDeck(r.deck!).filter((d) => d.severity === "warning")).toEqual([])
  })
})

describe("patch round-trips", () => {
  it("sets, replaces and removes props surgically", () => {
    const deck = must(SRC)
    const pinned = deck.slides[1].elements[2]
    let out = setProps(SRC, pinned.src!, { x: 300, w: 640, y: undefined }).source
    expect(out).toContain(`<Text x={300} w={640}>Pinned</Text>`)
    expect(out).toContain("// a comment that must survive")
    const again = must(out).slides[1].elements[2]
    expect(again.props).toMatchObject({ x: 300, w: 640 })
    expect(again.props.y).toBeUndefined()
  })

  it("refuses to overwrite computed values", () => {
    const deck = must(SRC)
    const list = deck.slides[1].elements[1]
    expect(() => setProps(SRC, list.src!, { items: ["z"] })).toThrow(PatchError)
  })

  it("edits text and keeps the rest of the file byte-identical", () => {
    const deck = must(SRC)
    const title = deck.slides[0].elements[0]
    const out = setText(SRC, title.src!, "Hi {there} <you>").source
    expect(must(out).slides[0].elements[0].text).toBe("Hi {there} <you>")
    expect(out.replace(/<Title>.*?<\/Title>/, "")).toBe(SRC.replace(/<Title>Hello<\/Title>/, ""))
  })

  it("edits multi-line text in place", () => {
    const deck = must(SRC)
    const text = deck.slides[0].elements[1]
    const out = setText(SRC, text.src!, "One\nTwo\nThree").source
    expect(must(out).slides[0].elements[1].text).toBe("One\nTwo\nThree")
    expect(out).toContain("      <Text>\n        One\n        Two\n        Three\n      </Text>")
  })

  it("adds text to a self-closing element", () => {
    const src = `export default <Deck><Slide><Text color="muted" /></Slide></Deck>`
    const d = must(src)
    const out = setText(src, d.slides[0].elements[0].src!, "Now with text").source
    expect(out).toContain(`<Text color="muted">Now with text</Text>`)
  })

  it("moves slides and keeps comments with them", () => {
    const deck = must(SRC)
    const out = moveSlide(SRC, deck.src!, 2, 0).source
    const moved = must(out)
    expect(moved.slides.map((s) => s.elements[0].text)).toEqual(["Third", "Hello", "Second"])
    expect(out).toContain("// a comment that must survive")
    expect(moveSlide(out, moved.src!, 0, 2).source).toBe(SRC)
  })

  it("inserts, duplicates, replaces and removes slides", () => {
    let src = SRC
    src = insertSlide(src, must(src).src!, 1, `<Slide layout="section">\n  <Title>New</Title>\n</Slide>`).source
    expect(must(src).slides.map((s) => s.elements[0].text)).toEqual(["Hello", "New", "Second", "Third"])
    expect(src).toContain(`    <Slide layout="section">\n      <Title>New</Title>\n    </Slide>`)
    src = duplicateSlide(src, must(src).src!, 3).source
    expect(must(src).slides.map((s) => s.id)).toContain("third-copy")
    src = replaceSlide(src, must(src).src!, 0, `<Slide><Title>Replaced</Title></Slide>`).source
    expect(must(src).slides[0].elements[0].text).toBe("Replaced")
    src = removeSlide(src, must(src).src!, 1).source
    expect(must(src).slides.map((s) => s.elements[0].text)).toEqual(["Replaced", "Second", "Third", "Third"])
  })

  it("inserts and removes elements", () => {
    const deck = must(SRC)
    let src = insertElement(SRC, deck.slides[2].src!, elementCode("text", { color: "muted" }, "Added")).source
    expect(src).toContain(`      <Title>Third</Title>\n      <Text color="muted">Added</Text>\n    </Slide>`)
    const d2 = must(src)
    src = removeElement(src, d2.slides[2].elements[1].src!).source
    expect(src).toBe(SRC)
  })

  it("str_replace edits require a unique match", () => {
    expect(applyEdits(SRC, [{ old: "<Title>Third</Title>", new: "<Title>3</Title>" }])).toContain("<Title>3</Title>")
    expect(() => applyEdits(SRC, [{ old: "<Slide", new: "x" }])).toThrow(/more than once/)
    expect(() => applyEdits(SRC, [{ old: "nope", new: "x" }])).toThrow(/not found/)
  })

  it("flags template elements when editing inside a map", () => {
    const src = `export default <Deck>{["a"].map((t) => <Slide><Title size="lg">{t}</Title></Slide>)}</Deck>`
    const d = must(src)
    const r = setProps(src, d.slides[0].elements[0].src!, { size: "xl" })
    expect(r.template).toBe(true)
    expect(() => setText(src, d.slides[0].elements[0].src!, "x")).toThrow(PatchError)
    expect(() => moveSlide(src, d.src!, 0, 1)).toThrow(PatchError)
  })

  describe("diagrams, icons and assets", () => {
    const DIA = `import { Deck, Slide, Flow, Step, Tree, Node, Icon, Image } from "ppt2"

export default (
  <Deck>
    <Slide>
      <Flow>
        <Step icon="pencil">Draft</Step>
        <Step id="ok" kind="diamond" to="ship:Yes">Tests pass?</Step>
        <Step id="ship">Ship</Step>
        <Text>not allowed</Text>
      </Flow>
      <Icon name="rocket" />
      <Image src="assets/team.jpg" focus="40% 20%" />
    </Slide>
    <Slide background="assets/bg.png">
      <Tree>
        <Node sub="Ada">
          CEO
          <Node>CTO</Node>
          <Node>CFO</Node>
        </Node>
      </Tree>
      <Step>stray</Step>
    </Slide>
  </Deck>
)`

    it("normalizes diagram items and warns about misplaced ones", () => {
      const r = compile(DIA)
      const flow = r.deck!.slides[0].elements[0]
      expect(flow.type).toBe("flow")
      expect(flow.children!.map((c) => c.text)).toEqual(["Draft", "Tests pass?", "Ship"])
      expect(flow.children![1].props.to).toBe("ship:Yes")
      const tree = r.deck!.slides[1].elements[0]
      expect(tree.children![0].text).toBe("CEO")
      expect(tree.children![0].children!.map((c) => [c.path, c.text])).toEqual([["1/0/0/0", "CTO"], ["1/0/0/1", "CFO"]])
      expect(r.deck!.slides[1].elements).toHaveLength(1)
      expect(r.warnings.map((w) => w.message).join("\n")).toMatch(/can only contain <Step>[\s\S]*must be inside <Flow>/)
      expect(outline(r.deck!)).toContain("flow diagram: Draft → Tests pass? → Ship")
    })

    it("edits a tree node label without touching its children", () => {
      const d = compile(DIA).deck!
      const ceo = d.slides[1].elements[0].children![0]
      const out = setText(DIA, ceo.src!, "Chief executive").source
      expect(out).toContain(`<Node sub="Ada">
          Chief executive
          <Node>CTO</Node>`)
      const again = compile(out).deck!.slides[1].elements[0].children![0]
      expect(again.text).toBe("Chief executive")
      expect(again.children).toHaveLength(2)
    })

    it("adds a prop while changing or removing the last one", () => {
      const src = `export default <Deck><Slide><Image src="a" zoom={1.5} /></Slide></Deck>`
      const at = compile(src).deck!.slides[0].elements[0].src!
      expect(setProps(src, at, { focus: "80% 20%", zoom: 2 }).source).toContain(`<Image src="a" zoom={2} focus="80% 20%" />`)
      expect(setProps(src, at, { focus: "80% 20%", zoom: undefined }).source).toContain(`<Image src="a" focus="80% 20%" />`)
    })

    it("lists referenced assets", () => {
      expect(assetRefs(compile(DIA).deck!).sort()).toEqual(["bg.png", "team.jpg"])
    })
  })
})

describe("brand kit", () => {
  const BRAND = `import { Deck, Slide, Title, Shape, Image } from "ppt2"

// Acme's company template
const brand = {
  base: "paper",
  colors: { accent: "#0a7cff" },
  fonts: { heading: "assets/Acme-Sans_Bold.woff2", body: [{ src: "assets/acme.woff2", family: "Acme", weight: 400 }, { src: "assets/acme-b.woff2", family: "Acme", weight: 700 }] },
  logo: { src: "assets/logo.svg", position: "bottom-left", inverse: "assets/logo-white.svg" },
  footer: "Acme · {n}/{total}",
  slideNumbers: true,
  master: <><Shape kind="rect" fill="accent" x={0} y={0} w={16} h={1080} /></>,
  layouts: {
    cover: { base: "title", variant: "inverse", master: false, elements: <Image src="assets/hero.jpg" x={1100} y={0} w={820} h={1080} /> },
  },
}

export default (
  <Deck title="Acme" theme={brand}>
    <Slide layout="cover" variant="accent">
      <Title>Hello</Title>
    </Slide>
    <Slide>
      <Title>Plain</Title>
    </Slide>
    <Slide master={false}>
      <Title>No chrome</Title>
    </Slide>
  </Deck>
)
`

  it("resolves logo, footer, numbers, font files, master and layouts", () => {
    const r = compile(BRAND)
    expect(r.warnings).toEqual([])
    const t = r.deck!.theme
    expect(t.colors.accent).toBe("#0a7cff")
    expect(t.colors.background).toBe("#f6f1e7") // from paper
    expect(t.logo).toEqual({ src: "assets/logo.svg", position: "bottom-left", height: 56, inverse: "assets/logo-white.svg" })
    expect(t.footer).toBe("Acme · {n}/{total}")
    expect(t.slideNumbers).toBe(true)
    expect(t.fonts.heading).toMatch(/^'Acme Sans Bold', 'Fraunces'/)
    expect(t.fonts.body).toMatch(/^'Acme', /)
    expect(t.fontFaces).toEqual([
      { family: "Acme Sans Bold", src: "assets/Acme-Sans_Bold.woff2", weight: "100 900", style: "normal" },
      { family: "Acme", src: "assets/acme.woff2", weight: "400", style: "normal" },
      { family: "Acme", src: "assets/acme-b.woff2", weight: "700", style: "normal" },
    ])
    expect(t.master).toHaveLength(1)
    expect(t.master![0]).toMatchObject({ type: "shape", path: "m/0", props: { fill: "accent", w: 16 } })
    expect(t.layouts!.cover).toMatchObject({ base: "title", props: { variant: "inverse", master: false } })
    expect(t.layouts!.cover.elements[0]).toMatchObject({ type: "image", path: "l:cover/0" })
  })

  it("applies theme layouts and the master opt-out to slides", () => {
    const d = compile(BRAND).deck!
    expect(d.slides[0]).toMatchObject({ layout: "title", themeLayout: "cover", props: { variant: "accent", master: false } })
    expect(d.slides[1].themeLayout).toBeUndefined()
    expect(d.slides[2].props.master).toBe(false)
    expect(outline(d)).toContain("Slide 1 [cover]")
    expect(outline(d)).toContain("brand: logo, footer, slide numbers, font files, 1 master elements, layouts cover")
  })

  it("lists brand assets with the deck's files", () => {
    expect(assetRefs(compile(BRAND).deck!).sort()).toEqual(["Acme-Sans_Bold.woff2", "acme-b.woff2", "acme.woff2", "hero.jpg", "logo-white.svg", "logo.svg"])
  })

  it("warns about unknown layouts, including theme ones in the hint", () => {
    const r = compile(BRAND.replace(`<Slide master={false}>`, `<Slide layout="nope">`))
    expect(r.warnings[0].message).toMatch(/Unknown layout "nope". Layouts: cover, title/)
    const bad = compile(`export default <Deck theme={{ base: "nah", logo: { src: "x.png", position: "middle" }, layouts: { a: { base: "zz" } } }}><Slide layout="a" /></Deck>`)
    expect(bad.warnings.map((w) => w.message)).toEqual([
      expect.stringMatching(/Unknown base theme "nah"/),
      expect.stringMatching(/Unknown logo position "middle"/),
      expect.stringMatching(/Theme layout "a": unknown base layout "zz"/),
    ])
    expect(bad.deck!.slides[0].layout).toBe("content")
  })

  describe("setThemeProps", () => {
    const deckOf = (src: string) => must(src).src!
    const one = (theme: string) => `export default <Deck title="x" ${theme}><Slide /></Deck>`

    it("turns a theme name into an object and back", () => {
      let src = one(`theme="midnight"`)
      src = setThemeProps(src, deckOf(src), { footer: "Acme", slideNumbers: true }).source
      expect(src).toBe(one(`theme={{ base: "midnight", footer: "Acme", slideNumbers: true }}`))
      expect(must(src).theme).toMatchObject({ name: "midnight+custom", footer: "Acme", slideNumbers: true })
      src = setThemeProps(src, deckOf(src), { footer: undefined, slideNumbers: undefined }).source
      expect(src).toBe(one(`theme="midnight"`))
    })

    it("adds a theme where there is none", () => {
      const src = one(``).replace(` >`, `>`)
      expect(setThemeProps(src, deckOf(src), { logo: "assets/logo.png" }).source).toContain(`<Deck title="x" theme={{ base: "snow", logo: "assets/logo.png" }}>`)
    })

    it("edits keys of a const theme in place, keeping comments and JSX", () => {
      const d = must(BRAND)
      let src = setThemeProps(BRAND, d.src!, { footer: "New footer", slideNumbers: undefined, logo: { src: "assets/logo.svg", position: "top-right" } }).source
      expect(src).toContain(`  footer: "New footer",\n  master: <>`)
      expect(src).not.toContain("slideNumbers")
      expect(src).toContain(`  logo: { src: "assets/logo.svg", position: "top-right" },`)
      expect(src).toContain("// Acme's company template")
      src = setThemeProps(src, must(src).src!, { base: "midnight", backdrop: "glow" }).source
      expect(src).toContain(`  base: "midnight",`)
      expect(src).toMatch(/  },\n  backdrop: "glow",\n}/)
      const t = must(src).theme
      expect(t).toMatchObject({ footer: "New footer", backdrop: "glow", logo: { position: "top-right" } })
      expect(t.slideNumbers).toBeUndefined()
      expect(t.master).toHaveLength(1)
    })

    it("removes the last key of an inline object without leaving a comma", () => {
      let src = one(`theme={{ base: "snow", footer: "a", logo: "b" }}`)
      src = setThemeProps(src, deckOf(src), { logo: undefined }).source
      expect(src).toBe(one(`theme={{ base: "snow", footer: "a" }}`))
      src = setThemeProps(src, deckOf(src), { base: undefined, footer: undefined, slideNumbers: true }).source
      expect(src).toBe(one(`theme={{ slideNumbers: true }}`))
    })

    it("breaks a long inline theme onto separate lines", () => {
      let src = `export default (\n  <Deck theme={{ base: "midnight", footer: "Acme" }}>\n    <Slide />\n  </Deck>\n)`
      src = setThemeProps(src, must(src).src!, { logo: { src: "assets/acme-logo.svg", inverse: "assets/acme-logo-white.svg" } }).source
      expect(src).toContain(`<Deck theme={{\n    base: "midnight",\n    footer: "Acme",\n    logo: { src: "assets/acme-logo.svg", inverse: "assets/acme-logo-white.svg" },\n  }}>`)
      src = setThemeProps(src, must(src).src!, { slideNumbers: true }).source
      expect(src).toContain(`inverse: "assets/acme-logo-white.svg" },\n    slideNumbers: true,\n  }}>`)
    })

    it("refuses to overwrite computed theme values", () => {
      const src = one(`theme={{ footer: "a" + "b" }}`)
      expect(() => setThemeProps(src, deckOf(src), { footer: "c" })).toThrow(PatchError)
      const fn = one(`theme={makeTheme()}`).replace("export", "const makeTheme = () => \"snow\"\nexport")
      expect(() => setThemeProps(fn, deckOf(fn), { footer: "c" })).toThrow(PatchError)
    })
  })
})

describe("components", () => {
  const COMP = `import { Deck, Slide, Title, Text, Card, Icon, Row, Slot, component } from "ppt2"

const Callout = component(
  <Card background="surface">
    <Icon name="lightbulb" />
    <Slot />
  </Card>
)

const Pair = component(
  <Row>
    <Callout>
      <Title>Left</Title>
      <Slot />
    </Callout>
  </Row>
)

export default (
  <Deck title="Components">
    <Slide>
      <Title>One</Title>
      <Callout x={100} y={200}>
        <Text>First</Text>
        <Text>Second</Text>
      </Callout>
      <Callout />
    </Slide>
    <Slide>
      <Pair>
        <Text>Inner</Text>
      </Pair>
    </Slide>
  </Deck>
)
`

  it("expands instances: template parts, slot children and instance props", () => {
    const deck = must(COMP)
    const [, inst] = deck.slides[0].elements
    expect(inst.type).toBe("card")
    expect(inst.props).toMatchObject({ background: "surface", x: 100, y: 200 })
    expect(inst.instance).toMatchObject({ name: "Callout", src: COMP.indexOf("<Callout x") , slot: { path: "0/1", index: 1, count: 2 } })
    expect(inst.component).toBeUndefined()
    expect(inst.children!.map((c) => [c.type, c.component, c.text])).toEqual([["icon", "Callout", undefined], ["text", undefined, "First"], ["text", undefined, "Second"]])
    // Template parts point into the definition, so editing them edits every use.
    expect(inst.children![0].src).toBe(COMP.indexOf("<Icon"))
    expect(deck.slides[0].elements[2].children).toHaveLength(1)
  })

  it("lists components with their definition and use count", () => {
    const deck = must(COMP)
    expect(deck.components.map((c) => [c.name, c.uses])).toEqual([["Callout", 3], ["Pair", 1]])
    const t = deck.components[0].template!
    expect(t.path).toBe("c/0")
    expect(t.children!.map((c) => c.type)).toEqual(["icon", "slot"])
    expect(t.children![1].src).toBe(COMP.indexOf("<Slot"))
  })

  it("nests components: inner slot content belongs to the outer component", () => {
    const deck = must(COMP)
    const pair = deck.slides[1].elements[0]
    expect(pair.instance?.name).toBe("Pair")
    const callout = pair.children![0]
    expect(callout.instance?.name).toBe("Callout")
    expect(callout.component).toBe("Pair")
    expect(callout.children!.map((c) => [c.type, c.component, c.text])).toEqual([["icon", "Callout", undefined], ["title", "Pair", "Left"], ["text", undefined, "Inner"]])
    expect(pair.instance?.slot).toEqual({ path: "1/0/0", index: 2, count: 1 })
  })

  it("warns about a <Slot /> outside a component and children without a slot", () => {
    const r = compile(`import { Deck, Slide, Text, Slot, component } from "ppt2"
const Badge = component(<Text>Badge</Text>)
export default <Deck><Slide><Slot /><Badge><Text>lost</Text></Badge></Slide></Deck>`)
    expect(r.warnings.map((w) => w.message).join("\n")).toMatch(/only works inside a component[\s\S]*has no <Slot \/>/)
  })

  it("edits the definition through a template part's src", () => {
    const deck = must(COMP)
    const icon = deck.slides[0].elements[1].children![0]
    const out = setProps(COMP, icon.src!, { name: "rocket" }).source
    const next = must(out)
    expect(next.slides[0].elements[1].children![0].props.name).toBe("rocket")
    expect(next.slides[0].elements[2].children![0].props.name).toBe("rocket")
  })

  it("defines, creates from an element, renames and removes components", () => {
    const base = `import { Deck, Slide, Title, Card, Text, component } from "ppt2"

export default (
  <Deck>
    <Slide>
      <Title>Hi</Title>
      <Card x={10} y={20} gap={8}>
        <Text>Body</Text>
      </Card>
    </Slide>
  </Deck>
)
`
    expect(componentName("price card!")).toBe("PriceCard")
    const defined = defineComponent(base, "Badge", "<Text>New</Text>").source
    expect(defined).toContain("const Badge = component(\n  <Text>New</Text>\n)\n\nexport default")
    expect(must(defined).components.map((c) => c.name)).toEqual(["Badge"])
    expect(() => defineComponent(defined, "Badge", "<Text />")).toThrow(PatchError)
    expect(() => defineComponent(defined, "Title", "<Text />")).toThrow(PatchError)

    const deck = must(defined)
    const made = componentFromElement(defined, deck.slides[0].elements[1].src!, "Panel", { slot: true }).source
    expect(made).toContain(`const Panel = component(
  <Card gap={8}>
    <Text>Body</Text>
    <Slot />
  </Card>
)`)
    expect(made).toContain(`<Panel x={10} y={20} />`)
    const after = must(made)
    expect(after.slides[0].elements[1].instance?.name).toBe("Panel")
    expect(after.slides[0].elements[1].props).toMatchObject({ x: 10, y: 20, gap: 8 })

    const renamed = renameComponent(made, "Panel", "Box").source
    expect(renamed).toContain("const Box = component(")
    expect(renamed).toContain("<Box x={10} y={20} />")
    expect(must(renamed).components.map((c) => c.name)).toEqual(["Badge", "Box"])

    expect(() => removeComponent(renamed, "Box")).toThrow(PatchError)
    const removed = removeComponent(renamed, "Badge").source
    expect(removed).not.toContain("Badge")
    expect(must(removed).components.map((c) => c.name)).toEqual(["Box"])
  })
})

describe("moving elements", () => {
  const src = `import { Deck, Slide, Title, Text, Row } from "ppt2"
export default (
  <Deck>
    <Slide>
      <Title>T</Title>
      <Text>A</Text>
      <Row>
        <Text>B</Text>
        <Text>C</Text>
      </Row>
      <Notes>n</Notes>
    </Slide>
  </Deck>
)
`
  const texts = (s: string) => {
    const els = must(s).slides[0].elements
    return els.map((e) => e.children ? `[${e.children.map((c) => c.text).join(",")}]` : e.text).join(" ")
  }

  it("inserts at an index", () => {
    const deck = must(src)
    expect(texts(insertElement(src, deck.slides[0].src!, "<Text>X</Text>", 1).source)).toBe("T X A [B,C]")
    expect(texts(insertElement(src, deck.slides[0].elements[2].src!, "<Text>X</Text>", 0).source)).toBe("T A [X,B,C]")
  })

  it("reorders within a parent and moves between parents", () => {
    const deck = must(src)
    const slide = deck.slides[0].src!
    const [title, a, row] = deck.slides[0].elements
    expect(texts(moveElement(src, title.src!, slide, 2).source)).toBe("A T [B,C]")
    expect(texts(moveElement(src, title.src!, slide).source)).toBe("A [B,C] T")
    expect(texts(moveElement(src, a.src!, row.src!, 1).source)).toBe("T [B,A,C]")
    expect(texts(moveElement(src, row.children![1].src!, slide, 0).source)).toBe("C T A [B]")
    expect(moveElement(src, a.src!, slide, 1).source).toBe(src)
    expect(() => moveElement(src, row.src!, row.children![0].src!, 0)).toThrow(PatchError)
    // Notes stay last.
    expect(moveElement(src, title.src!, slide).source).toMatch(/<Title>T<\/Title>\n      <Notes>/)
  })
})
