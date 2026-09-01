import { spawn } from 'node:child_process'

const SUITES = ['smoke', 'core', 'toolbar', 'controls', 'panel', 'figma', 'typography', 'fill', 'image-fill', 'swap-image', 'text', 'list', 'comment', 'comment-refs', 'guides', 'drag', 'advanced']
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
