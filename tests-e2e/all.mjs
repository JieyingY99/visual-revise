import { spawn } from 'node:child_process'

const SUITES = ['smoke', 'core', 'toolbar', 'controls', 'panel', 'figma', 'typography', 'layout', 'grid', 'resizing', 'fill', 'image-fill', 'swap-image', 'text', 'list', 'comment', 'comment-refs', 'removal', 'reanchor', 'tree', 'history', 'guides', 'drag', 'advanced',
  // PRD 验收：按 docs/PRD.md 的 AC 编号逐条走，排在最后——
  // 上面那些按技术模块组织、跟着实现一路加，天然偏向「已实现的那条路径」；
  // 这四个按用户目标组织，专门用来暴露「功能存在但没人真的走过这条路」。
  'acceptance', 'acceptance-panel', 'acceptance-content', 'acceptance-export',
  // 颜色变量绑定 / !important 写入 / Typography 可见性：三件事互相牵连
  // （变量页写的是 var()，样式表带 important 时压不过去，容器上根本不该有这些格子）
  'acceptance-variables',
  // 只问「长得对不对」：间距、等高、图标比例、有没有被挤出边界。
  // 功能全绿的界面照样可以是歪的，这些单看功能断言永远发现不了。
  'acceptance-ui',
  // 四类弹层的滚动 / Esc / 点外 / 键盘——各自挂在 body 上各自管关闭，容易各漏一样
  'acceptance-popover']
const results = []

for (const suite of SUITES) {
  const out = await new Promise(resolve => {
    let buf = ''
    const p = spawn('node', [`tests-e2e/${suite}.mjs`], { cwd: process.cwd() })
    p.stdout.on('data', d => buf += d)
    p.stderr.on('data', d => buf += d)
    p.on('close', code => resolve({ code, buf }))
  })

  const pass = (out.buf.match(/✔/g) || []).length
  const fail = (out.buf.match(/✘/g) || []).length
  results.push({ suite, pass, fail, code: out.code })
  console.log(`${fail || out.code ? '✘' : '✔'} ${suite.padEnd(10)} ${String(pass).padStart(3)} 通过  ${fail} 失败`)
  if (fail || out.code) console.log(out.buf.split('\n').filter(l => l.includes('✘') || l.includes('Error')).join('\n'))
}

const totalPass = results.reduce((n, r) => n + r.pass, 0)
const totalFail = results.reduce((n, r) => n + r.fail, 0)
const broken = results.filter(r => r.code).length

console.log(`\n${'─'.repeat(46)}`)
console.log(`合计：${totalPass} 通过 / ${totalFail} 失败 / ${broken} 个套件异常退出`)
process.exitCode = totalFail || broken ? 1 : 0
