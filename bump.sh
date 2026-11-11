#!/bin/zsh
# 改完 js 后跑一下再部署：给 public 里 html 的脚本地址换新版本号，防止浏览器缓存新旧混用
# （2026-11-11 出过事：index.html 是新的、gen.js 是缓存的旧版，点导出没反应）
cd "${0:A:h}/public" && V=$(date +%Y%m%d%H%M) && for f in index.html store.html login.html; do [ -f $f ] && sed -i '' -E "s#<script src=\"((gen\.js|xls\.js|api\.js|vendor/[a-z.]+\.js))(\?v=[0-9]+)?\"></script>#<script src=\"\1?v=$V\"></script>#g" $f; done; echo "v=$V"
