import resolve  from 'rollup-plugin-node-resolve'
import postcss  from 'rollup-plugin-postcss'
import {terser} from 'rollup-plugin-terser'

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

const plugins = is_prod
  ? [...dev_plugins, ...prod_plugins]
  : dev_plugins

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