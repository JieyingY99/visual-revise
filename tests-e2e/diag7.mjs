import { serve, launch } from './harness.mjs'
const { port, close } = await serve()
const { browser, page } = await launch({ headless: true })
await page.goto(`http://127.0.0.1:${port}`)

console.log(await page.evaluate(() => {
  const card = document.querySelectorAll('.curve-card')[0]
  const r = card.getBoundingClientRect()
  const probe = (x, y) => document.elementsFromPoint(x, y).map(n =>
    n.tagName + (typeof n.className === 'string' && n.className ? '.' + n.className : ''))

  return {
    rawRect: { x: r.x, y: r.y, w: r.width, h: r.height, top: r.top, left: r.left },
    scroll: { x: scrollX, y: scrollY },
    at_x4_y4:      probe(r.x + 4, r.y + 4),
    at_center:     probe(r.x + r.width / 2, r.y + r.height / 2),
    at_x20_y20:    probe(r.x + 20, r.y + 20),
    cardStyles: {
      pointerEvents: getComputedStyle(card).pointerEvents,
      position: getComputedStyle(card).position,
      display: getComputedStyle(card).display,
      visibility: getComputedStyle(card).visibility,
    },
  }
}))
await browser.close(); await close()
