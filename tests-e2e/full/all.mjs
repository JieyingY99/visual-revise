// 全量功能测试集的跑批入口：按 docs/plans/feature-inventory.md 的分块，一个分块一个套件。
// 跟 tests-e2e/all.mjs 分开跑——这一套一次要十几分钟，日常回归用外面那套，
// 大改动或发版前跑这套。报告见 docs/plans/full-e2e-report.md。
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SUITES = ['toolbar', 'panel-head-position', 'layout-appearance', 'typography-fill', 'stroke-effects',
  'variables-grid', 'tree', 'popovers', 'select-handles-text', 'drag-guides-upstream', 'history-changes',
  'export-comments-misc']

const only = process.argv.slice(2)
const run = name => new Promise(resolve => {
  const child = spawn(process.execPath, [join(__dirname, `${name}.mjs`)], { stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  child.stdout.on('data', d => { out += d })
  child.stderr.on('data', d => { out += d })
  child.on('close', code => resolve({ name, code, out }))
})

let passed = 0, failed = 0, crashed = 0
for (const name of only.length ? only : SUITES) {
  const { code, out } = await run(name)
  const ok = (out.match(/✔/g) || []).length
  const bad = (out.match(/✘/g) || []).length
  passed += ok; failed += bad
  if (code !== 0 && !bad) crashed++
  console.log(`${bad || code ? '✘' : '✔'} ${name.padEnd(24)} ${ok} 通过  ${bad} 失败${code && !bad ? '  （异常退出）' : ''}`)
  for (const line of out.split('\n').filter(l => l.includes('✘'))) console.log('  ' + line.trim())
}
console.log('\n──────────────────────────────────────────────')
console.log(`合计：${passed} 通过 / ${failed} 失败 / ${crashed} 个套件异常退出`)
process.exitCode = failed || crashed ? 1 : 0
