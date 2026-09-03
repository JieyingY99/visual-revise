import resolve  from 'rollup-plugin-node-resolve'
import postcss  from 'rollup-plugin-postcss'
import {terser} from 'rollup-plugin-terser'
import {mkdirSync, writeFileSync} from 'node:fs'

const is_prod = process.env.build === 'prod'

const dev_plugins = [
  resolve({
    jsnext: true,
  }),
  postcss({
    extract: false,
    inject:  false,
  }),
]

const prod_plugins = [
  terser(),
]

// 把这次构建的时间也落一份到扩展目录。inject.js 每次点图标都会被重新
// 注入（executeScript 读的是磁盘上的当前文件），所以它读到的一定是最新值；
// 而页面里那份 bundle 是 ES module、按 URL 去重，同一个页面只求值一次。
// 两者一比就知道「页面跑的是不是这次构建的代码」。
const build_id_plugin = {
  name: 'vr-build-id',
  writeBundle() {
    mkdirSync('extension/toolbar', { recursive: true })
    writeFileSync(
      'extension/toolbar/build-id.json',
      JSON.stringify({ build: BUILD_STAMP }) + '\n')
  },
}

const plugins = is_prod
  ? [...dev_plugins, ...prod_plugins, build_id_plugin]
  : [...dev_plugins, build_id_plugin]

// 构建时间戳注入产物。改稿工具迭代很快，而扩展重载 / 页面刷新 / 脚本缓存
// 三者任缺一环，用户看到的就还是上一版——但从界面上分辨不出来。
// 打印一行构建时间，「我这份是不是最新的」就有了确切答案。
const BUILD_STAMP = new Date().toISOString()

export default {
  input: 'app/index.js',
  output: {
    file:       is_prod ? 'app/bundle.min.js' : 'app/bundle.js',
    format:     'es',
    sourcemap:  is_prod ? null : 'inline',
    banner:     `const __VR_BUILD__ = ${JSON.stringify(BUILD_STAMP)};`,
  },
  plugins,
  watch: {
    exclude: ['node_modules/**'],
  }
}