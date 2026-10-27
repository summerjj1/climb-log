# MEI攀 · COS 试用接入

截至 2026-10-26，已在腾讯云控制台创建 `mei-climb-media-1517391545`，地域 `ap-shanghai`，单 AZ、私有读写。CORS 已限定到正式 Netlify 网址及 127.0.0.1:5173 / :4173，方法 GET/PUT/DELETE/HEAD，允许 content-type、content-length、x-cos-forbid-overwrite。

## 目前状态

COS 服务与私有桶已创建；代码和隔离测试已完成。**未配置服务端密钥、未部署签名函数、未启用 COS 上传、未执行真实上传、未开通云端转码。** 当前线上与普通本地构建仍使用 Supabase。

这一步只替换文件存储。登录、岩馆、线路、完成状态仍在原 Supabase 项目。旧文件不迁移；新 COS 文件路径包含 `/cos/`，以后即使关闭新上传开关，仍保留 COS 读取能力。含 COS 文件的记录必须使用支持 COS 的前端版本读取，不可回退到本次修改前的旧前端。

原视频输入 1 GB / 10 分钟，仍在浏览器保持原速压缩，保存文件上限仍为 20 MB。MPS 云端转码属于后续阶段，需要单独确认服务授权及费用；本代码不会上传 1 GB 原片或调用付费转码。

## 服务端权限

申请专用 CAM 编程访问子用户 `mei-climb-storage`，仅绑定本目录 `cam-policy.json` 所列权限：本桶 `mei-climb/*` 文件的上传、读取与删除。不授予列表桶、管理桶、修改权限、其他桶、MPS 或全账号权限。

创建新访问凭据和授予权限前须由用户确认。SecretId / SecretKey 由用户直接填写到 Netlify 环境变量，作用域仅 Functions，禁止加 VITE_ 前缀、提交进仓库、放进静态 ZIP 或发送到聊天。不要使用腾讯云主账号密钥。

Netlify 服务端变量：

| 变量 | 值 |
| --- | --- |
| COS_SECRET_ID | 专用子用户 SecretId，由用户填写 |
| COS_SECRET_KEY | 专用子用户 SecretKey，由用户填写 |
| COS_ALLOWED_USER_IDS | f8202780-662c-4ba5-afcb-739c3281cc22 |

`server/cos-sign.mjs` 固定目标桶、地域与 Supabase 项目，使用 Auth API 验证登录 token；客户端传来的 ID 不能代替登录校验。签名只针对本人路径，有效期 300 秒。PUT 签名绑定文件大小、类型和禁止覆盖；没有试用白名单时拒绝全部访问。响应禁止缓存。文件直传 COS，不经过 Netlify 函数传输，函数只返回短期授权。

## 部署与启用

1. 在用户确认授权后创建限定权限的 CAM 身份，用户将密钥填入 Netlify Functions 环境变量。
2. 先部署函数（`netlify/functions/cos-sign.mjs`）与当前兼容前端。`netlify.toml` 已指定函数目录和 esbuild 打包。使用 Netlify CLI / API 或 Git 构建部署到现有项目；**普通 dist ZIP 拖放不能单独完成这次函数部署**。
3. 完成批准后的合成图片/视频实际上传、刷新、读取、删除验证，再开启试用。真实请求和下载流量可能计费，先取得小额测试预算；未获准不执行。
4. 为本账号开启前端构建变量：`VITE_COS_UPLOADS=true`、`VITE_COS_USER_IDS=f8202780-662c-4ba5-afcb-739c3281cc22`。其他账号继续用 Supabase。默认签名接口为同站点 `/.netlify/functions/cos-sign`，本地测试可用 `VITE_COS_SIGN_ENDPOINT` 指向部署好的 HTTPS 接口。
5. 验证新记录的 photoPath 是 `用户ID/cos/UUID.扩展名`，旧照片、通关标记、备份恢复仍正常。

尚未实测新桶默认域名的 Blob 下载兼容性，必须完成第 3 步才能宣称接入成功。下载采用 fetch Blob + 本地 object URL，与现有私有预览流程一致，不将桶改为公有读。

## 回退与测试

关闭 `VITE_COS_UPLOADS` 并重新构建，后续文件回到 Supabase；保留已上线的签名函数及 COS 凭据，供已保存 COS 文件读取，不删除用户数据。

执行 `npm run test:cos` 检查签名、登录、账号隔离、路径、大小、类型、白名单和适配器；`node tests/cloud.mjs` 检查现有并发保存与失败恢复；`node tests/cloud-e2e.mjs` 检查原登录与同步流程。测试使用合成数据和模拟传输，未访问真实 COS 数据。

50 GB / 180 天赠送额度只包含适用范围内的标准存储容量，不涵盖所有请求、流量和转码费用。按量计费仍已启用；本阶段不设置自动充值，也不启用 CDN、全球加速或数据万象。
