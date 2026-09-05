#!/usr/bin/env bash
# 打出可直接上传 Chrome Web Store / Edge Add-ons 的扩展包。
#
# 与上游 extension:zip 的区别：
#   1. manifest.json 位于 zip 根目录（商店硬性要求，套一层目录会报
#      "Manifest file is missing or unreadable"）
#   2. 带上 LICENSE 与 NOTICE（Apache-2.0 第 4(a) 条：分发副本须附许可证）
#   3. 排除 .DS_Store / __MACOSX / build 目录等 macOS 与构建残留
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
STAGE="$(mktemp -d)"
OUT="$ROOT/dist"
ZIP="$OUT/visual-revise-v${VERSION}.zip"

trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$OUT"
rm -f "$ZIP"

# 扩展本体 → staging 根目录（manifest.json 因此落在 zip 根）
rsync -a \
  --exclude '.DS_Store' \
  --exclude '__MACOSX' \
  --exclude 'build/' \
  --exclude '*.map' \
  extension/ "$STAGE/"

# Apache-2.0 归属材料随包分发
cp LICENSE NOTICE "$STAGE/"

# manifest 完整性自检
MANIFEST="$STAGE/manifest.json"
[ -f "$MANIFEST" ] || { echo "❌ manifest.json 不在 zip 根目录"; exit 1; }
node -e "
  const m = require('$MANIFEST');
  const errs = [];
  if (m.manifest_version !== 3) errs.push('manifest_version 必须为 3');
  if (!m.name || /VisBug|DevBug/i.test(m.name))
    errs.push('name 仍含上游名称（可能误跑了 extension:local:version）: ' + m.name);
  if (m.version !== '$VERSION')
    errs.push('manifest.version ($' + '{m.version}) 与 package.json ($VERSION) 不一致');
  if (/{{.*}}/.test(JSON.stringify(m))) errs.push('manifest 残留未替换的占位符');
  for (const k of ['16','32','48','128'])
    if (!m.icons?.[k]) errs.push('缺少 ' + k + 'x' + k + ' 图标');
  if (/visbug/i.test(JSON.stringify(m.icons || {})))
    errs.push('图标仍指向上游 visbug 资源，需替换为自有图标');
  if (errs.length) { errs.forEach(e => console.error('  ❌ ' + e)); process.exit(1); }
"

( cd "$STAGE" && zip -q -r -X "$ZIP" . -x '.*' '*/.*' )

echo "✅ 打包完成: $ZIP"
echo "   大小: $(du -h "$ZIP" | cut -f1)"
echo ""
echo "   zip 根目录内容:"
unzip -l "$ZIP" | awk 'NR>3 && $4 !~ /\// && $4 != "" {print "     " $4}' | head -10
