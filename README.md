# QRTransfer

个人离线光学传输工具。Windows 双击 sender.html 发送；手机打开 Pages 接收页面，首次加载后可离线使用。文件不上传到任何服务。仅在获准传输的数据与设备上使用。

## 构建

`npm ci && npm test && npm run build`

dist/sender.html 为独立离线文件；dist/index.html 为 HTTPS/PWA 接收入口。Pages 使用 GitHub Actions，需在仓库设置中启用。私有仓库需要支持 Pages 的 GitHub 套餐；发布页面可能公开，不包含实际传输文件。

## 传输协议

QRT1 + 96-bit 会话标识 + BC-UR bytes。复用 @ngraveio/bc-ur 的喷泉码与 Bytewords 校验，允许漏帧、乱序、重复；持续生成冗余帧直至接收成功。数据封装包含版本、文件名、类型、字节长度、SHA-256；最后校验会话摘要、长度及原始文件 SHA-256，校验失败不提供保存。SHA-256 不提供保密性或发送者身份认证。

二维码编码：qrcode (MIT)，解码：jsQR (Apache-2.0)，喷泉码：@ngraveio/bc-ur (MIT)，SHA-256：sha.js (MIT)。所有依赖在构建时本地打包，不使用运行时 CDN。依赖许可证详见 npm 包内 LICENSE。

首版限制：单文件 512 KiB，默认 4 帧/秒；暂停保留内存进度，刷新/关闭不续传；没有加密和自动确认通道。性能及 iOS/Android 实机兼容性需要验证。PWA 缓存可能被操作系统清理。
