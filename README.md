# QRTransfer

个人离线光学传输工具。Windows 双击 sender.html 发送；手机打开 Pages 接收页面，首次加载后可离线使用。文件不上传到任何服务。仅在获准传输的数据与设备上使用。

## 构建

`npm ci && npm test && npm run build`

dist/sender.html 为独立离线文件；dist/index.html 为 HTTPS/PWA 接收入口。Pages 使用 GitHub Actions，需在仓库设置中启用。私有仓库需要支持 Pages 的 GitHub 套餐；发布页面可能公开，不包含实际传输文件。

## 传输协议

QRT2 + 96-bit 会话标识 + 分块编号 + BC-UR bytes。发送端分块计算文件 SHA-256，通过 Blob.slice 按需读取 32 KiB 数据块；每块独立使用喷泉码，循环发送系统帧及冗余帧。文件元信息随每块重复发送，接收端支持乱序、重复、漏帧及跨轮补偿；最后按块顺序校验整文件长度与 SHA-256，校验失败不提供保存。QRT2 接收端兼容旧 QRT1 发送端；旧接收端需升级才能接收 QRT2。SHA-256 不提供保密性或发送者身份认证。

二维码编码：qrcode (MIT)，解码：jsQR (Apache-2.0)，喷泉码：@ngraveio/bc-ur (MIT)，SHA-256：sha.js (MIT)。所有依赖在构建时本地打包，不使用运行时 CDN。依赖许可证详见 npm 包内 LICENSE。

QRT2 不设固定文件大小上限，但接收端在浏览器内存保留数据块，最终生成 Blob，实际容量及耗时受设备、浏览器及光学通道约束。默认 4 帧/秒；接收速度基于最近 5 秒恢复的有效原始数据估算，重复帧不增加有效字节。超过 1 MiB 的文本仅提供文件保存，避免大文本渲染影响界面。暂停保留内存进度，刷新/关闭不续传；没有加密和自动确认通道。性能及 iOS/Android 实机兼容性需要验证。PWA 缓存可能被操作系统清理。
