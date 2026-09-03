import { spawn } from 'node:child_process'

const SUITES = ['smoke', 'core', 'toolbar', 'controls', 'panel', 'figma', 'typography', 'layout', 'grid', 'resizing', 'fill', 'image-fill', 'swap-image', 'text', 'list', 'comment', 'comment-refs', 'removal', 'reanchor', 'tree', 'history', 'guides', 'drag', 'advanced',
  // PRD 验收：按 docs/PRD.md 的 AC 编号逐条走，排在最后——
  // 上面那些按技术模块组织、跟着实现一路加，天然偏向「已实现的那条路径」；
  // 这四个按用户目标组织，专门用来暴露「功能存在但没人真的走过这条路」。
  'acceptance', 'acceptance-panel', 'acceptance-content', 'acceptance-export']
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
