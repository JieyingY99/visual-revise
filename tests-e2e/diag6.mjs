import { serve, launch, injectVisBug } from './harness.mjs'
const { port, close } = await serve()
const origin = `http://127.0.0.1:${port}`
const { browser, page } = await launch({ headless: true })
await page.goto(origin)

console.log('=== 注入前 ===')
console.log(await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('.curve-card'))
  return cards.map((c, i) => {
    const r = c.getBoundingClientRect()
    const hit = document.elementsFromPoint(r.x + 4, r.y + 4)
    return { i, rect: [r.x, r.y, r.width, r.height].map(Math.round),
             hitTop: hit[0]?.tagName + '.' + (hit[0]?.className || '') }
  })
}))

await injectVisBug(page, origin)
console.log('\n=== 注入后 ===')
console.log(await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('.curve-card'))
  return cards.map((c, i) => {
    const r = c.getBoundingClientRect()
    const hit = document.elementsFromPoint(r.x + 4, r.y + 4)
    return { i, rect: [r.x, r.y, r.width, r.height].map(Math.round),
             hitStack: hit.slice(0, 3).map(n => n.tagName + (typeof n.className === 'string' && n.className ? '.' + n.className.split(' ')[0] : '')) }
  })
}))
console.log('\nbody 上的编辑器元素:', await page.evaluate(() =>
  Array.from(document.body.children).map(n => n.tagName).filter(t => t.includes('VIS') || t.includes('REVISE'))))
console.log('\ncards 容器 rect:', await page.evaluate(() => {
  const r = document.querySelector('.cards').getBoundingClientRect()
  return [r.x, r.y, r.width, r.height].map(Math.round)
}))
await browser.close(); await close()
