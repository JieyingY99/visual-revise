/**
 * Copyright 2026 Jieying Yang. Licensed under the Apache License 2.0.
 * Part of Visual Revise, built on Project VisBug. See NOTICE.
 */
// 快捷键的修饰键按平台走：Mac 上是 ⌘，Windows / Linux 上是 Ctrl。
//
// 早先各处写 `e.metaKey || e.ctrlKey` 两边都认，看似兼容，实际上 Mac 上
// Ctrl+C 这种系统没占用的组合也会被吃掉；而提示文字写死 ⌘，Windows 用户看
// 不懂。所有快捷键统一从这里取修饰键判断与显示文案。

const platform = navigator.userAgentData?.platform || navigator.platform || ''
export const isMac = /mac|iphone|ipad|ipod/i.test(platform)

// 「主修饰键」是否按下：Mac 看 ⌘，其它看 Ctrl。另一边按着时不算——
// Mac 上 Ctrl+⌘+C 是别的组合
export const isMod = e => isMac ? (e.metaKey && !e.ctrlKey) : (e.ctrlKey && !e.metaKey)

export const MOD = isMac ? '⌘' : 'Ctrl'
export const ALT = isMac ? '⌥' : 'Alt'
export const SHIFT = isMac ? '⇧' : 'Shift'
// 真·Control 键。Mac 上它和主修饰键（⌘）是两个键，Windows 上则是同一个，
// 所以不能直接拿 MOD 当 Ctrl 用
export const CTRL = isMac ? '⌃' : 'Ctrl'

// 组合键的显示文案。调用方只声明「要哪几个修饰键 + 主键」，
// 顺序与连接符由这里按平台归一化：
//   combo({ mod: true, alt: true }, 'C') → Mac「⌥⌘C」/ Windows「Ctrl+Alt+C」
//
// 为什么不能让调用方自己排顺序：两个平台的习惯顺序是反的。
// Mac 按 Apple 的 ⌃⌥⇧⌘ 固定排列（⌘ 永远贴着主键），Windows 习惯
// Ctrl+Alt+Shift。同一串参数无论怎么排，总有一边是错的（⌥⌘C ✓ / Alt+Ctrl+C ✗，
// ⌘⌥C ✗ / Ctrl+Alt+C ✓）——只换连接符不够，顺序也得翻。
export const combo = ({ ctrl = false, alt = false, shift = false, mod = false } = {}, key = '') => {
  const parts = isMac
    ? [ctrl && CTRL, alt && ALT, shift && SHIFT, mod && MOD]
    // 非 Mac 上 MOD 就是 Ctrl，与显式的 ctrl 是同一个键，合成一项才不会
    // 写出 Ctrl+Ctrl+C
    : [(mod || ctrl) && MOD, alt && ALT, shift && SHIFT]

  const list = parts.filter(Boolean)
  if (key) list.push(key)
  return isMac ? list.join('') : list.join('+')
}
