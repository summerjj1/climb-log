# Cloudflare Pages 部署

在 Pages 中连接 `summerjj1/climb-log`，配置：

- 生产分支：`main`
- 框架预设：None
- 构建命令：`npm run build:pages`
- 输出目录：`dist-pages`
- 根目录：留空
- Node.js：22（可设置构建变量 `NODE_VERSION=22`）

此构建在根路径提供腾讯云版，`/tencent/` 重定向到根路径。
`.env.cloudbase` 只有公开的服务选择和环境 ID，不包含服务端密钥。
请勿向任何 `VITE_*` 构建变量添加腾讯云 SecretKey 或管理密钥。

发布后，须在腾讯云为实际分配的 `*.pages.dev` 域名配置安全来源及所需的认证回调地址，然后验证注册、登录、云端读取、上传和视频播放。已有用户继续使用原腾讯云账号，媒体和数据库不迁移。

Pages 单文件上限为 25 MiB。`build:pages` 将 FFmpeg WASM 拆成不超过 16 MiB 的文件，仅在选择软件压缩时按需加载并在浏览器还原。快速压缩与原片模式不加载这些文件。普通 Netlify 构建仍使用完整 WASM。

本地验证：

```sh
npm ci
npm run build:pages
npx vite preview --host 127.0.0.1 --port 4176 --outDir dist-pages
# 另一个终端执行（使用既有视频测试生成的合成 4 秒样本）：
node tests/pages-build.mjs
```

这些步骤不会自动公开腾讯云文件桶或修改数据库读取权限。
