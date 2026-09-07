# KeePass Wox Plugin

[![Wox](https://img.shields.io/badge/Wox-v2.0.4+-blue.svg)](https://github.com/Wox-launcher/Wox)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/Myraxion/Wox.Plugin.Keepass)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/Myraxion/Wox.Plugin.Keepass)

专为 [Wox](https://github.com/Wox-launcher/Wox) 启动器打造的高效、安全、纯内存驻留的 KeePass (KDBX4) 凭据检索插件。

---

## ✨ 特性亮点

- ⚡ **极速凭据检索**：支持对条目标题、用户名、网址、标签及备注进行模糊与精准匹配，内置多维度智能相关度排序算法。
- 🔒 **严格内存安全**：遵循零磁盘持久化原则，主密码与解密后的数据库对象仅在进程内存中保存，绝不落盘、绝不记录明文日志。
- ⏱️ **空闲自动锁定**：支持自定义无操作超时自动锁定，且后台实时监听数据库文件变动（mtime 变化时自动安全锁定）。
- 📑 **原生 Markdown 预览卡片**：右侧原生 Markdown 分栏呈现凭据详情、隐藏密码掩码、网址、标签、群组路径及备注。
- 🕒 **完整 TOTP / 2FA 支持**：严格遵循 KeePassXC 标准（`otp` 字段中的 `otpauth://` URI），支持 RFC 6238 标准动态验证码及 Steam Guard 令牌，支持格式化显示与倒计时徽章。
- ⌨️ **纯键盘驱动操作**：支持全局快捷键一键复制密码、用户名、TOTP 验证码或在浏览器中打开网址。
- 🔍 **结构化字段检索**：支持 `u:`、`t:`、`url:`、`g:` 等前缀检索，并完整支持带空格的双引号短语（如 `u:"John Doe"`）。
- 🚫 **细粒度排除规则**：支持通过标签或群组规则排除特定条目（如废纸篓、归档分组）。
- 🌐 **跨平台纯 WASM 架构**：采用纯 WebAssembly 实现 Argon2 密钥派生与内存 Base64 图标流式传输，无本地 C++ 编译依赖，Windows、macOS、Linux 体验一致。

---

## 📦 安装

### 方式一：通过 Wox 包管理器安装（推荐）

在 Wox 搜索框中执行：

```text
wpm install KeePass
```

### 方式二：手动安装

1. 从 [Releases](https://github.com/Myraxion/Wox.Plugin.Keepass/releases) 下载最新的 `wox.plugin.keepass.wox` 安装包。
2. 在 Wox 设置中选择从文件安装，或将解压内容放置在 Wox 插件目录中。

---

## ⚙️ 配置说明

安装完成后，请进入 **Wox 设置** -> **插件** -> **KeePass** 进行基础配置：

| 配置项                 | 键名 (`Key`)      | 类型     |  必填  | 默认值 | 说明                                                                          |
| :--------------------- | :---------------- | :------- | :----: | :----: | :---------------------------------------------------------------------------- |
| **KeePass 数据库路径** | `kdbxFilePath`    | 单行文本 | **是** |  `空`  | 本地 `.kdbx` 数据库文件的绝对路径                                             |
| **密钥文件路径**       | `keyFilePath`     | 单行文本 |   否   |  `空`  | 可选的 `.key` 或密钥文件绝对路径                                              |
| **自动锁定超时 (秒)**  | `autoLockTimeout` | 整数     |   否   | `900`  | 数据库空闲自动锁定的时间（秒）。默认 900 秒（15 分钟），设为 `0` 则不自动锁定 |
| **排除规则**           | `excludeRules`    | 单行文本 |   否   |  `空`  | 逗号分隔的排除规则，如 `g:"Recycle Bin", t:Trash`                             |

---

## 🚀 使用指南

### 1. 触发插件

插件默认触发关键字为 `kp` 或 `keepass`。

### 2. 解锁数据库

在搜索框输入主密码并按 `Enter` 键即可完成解锁：

```text
kp 你的主密码
```

> **说明**：为了防止在连续输入密码时频繁触发计算耗时的 Argon2 / AES-KDF 密钥派生算法导致 UI 冻结，插件采用**显式回车解锁**机制；解锁成功后，搜索框内的明文密码将被自动清除。

### 3. 快速锁定

如需立即手动锁定数据库，输入：

```text
kp lock
```

### 4. 检索条目

解锁后即可直接输入关键词进行模糊匹配搜索：

```text
kp github
```

#### 高级字段前缀语法

支持在搜索词中添加特定字段前缀实现精准定位，多个条件以空格分隔；包含空格的值可使用双引号包裹：

| 语法前缀     | 含义             | 示例                              |
| :----------- | :--------------- | :-------------------------------- |
| `u:<用户名>` | 按用户名搜索     | `kp u:admin` 或 `kp u:"John Doe"` |
| `url:<网址>` | 按网址搜索       | `kp url:github.com`               |
| `t:<标签>`   | 按标签过滤       | `kp t:server`                     |
| `g:<群组>`   | 按群组路径过滤   | `kp g:"Work/Accounts"`            |
| 组合查询     | 任意条件自由组合 | `kp github u:myname t:dev`        |

### 5. 操作快捷键

选定目标条目后，可直接使用以下快捷键快速执行动作：

| 快捷键 (Windows/Linux) | 快捷键 (macOS) | 动作           | 说明                                             |
| :--------------------- | :------------- | :------------- | :----------------------------------------------- |
| `Enter`                | `Enter`        | **复制密码**   | 默认动作，将解密后的密码写入系统剪贴板           |
| `Ctrl + U`             | `Cmd + U`      | **复制用户名** | 将用户名复制到系统剪贴板                         |
| `Ctrl + T`             | `Cmd + T`      | **复制 TOTP**  | 计算当前动态口令并写入剪贴板（支持 Steam Guard） |
| `Ctrl + O`             | `Cmd + O`      | **打开网址**   | 在系统默认浏览器中打开该条目绑定的 URL           |

---

## 🚫 排除规则设置

可在插件设置的 **排除规则** (`excludeRules`) 中指定需要忽略的群组或标签，多条规则使用半角逗号 `,` 分隔：

- **排除特定群组**：使用 `g:` 前缀，包含空格时用引号包裹，如 `g:"Recycle Bin"`、`g:Archive`
- **排除特定标签**：使用 `t:` 前缀，如 `t:Trash`、`t:Deprecated`

**示例配置**：

```text
g:"Recycle Bin", g:Trash, t:Hidden
```

---

## 🛡️ 安全设计

1. **纯内存驻留 (In-Memory Only)**：主密码、派生密钥及解密后的数据库对象均仅保存在 Node.js 运行时内存中，绝不写入磁盘缓存或持久化配置。
2. **输入框即时擦除**：解锁成功后通过 Wox `api.ChangeQuery` 立即覆写搜索框输入，避免主密码停留在前台。
3. **文件变动感知**：监听数据库文件变动与修改时间戳（mtime），一旦检测到外部同步软件（如 Syncthing、Dropbox、OneDrive）修改了数据库，立即销毁内存会话并锁定。
4. **内存图标流**：自定义条目图标直接以内存 Base64 Data URI 形式加载渲染，绝不向磁盘写出任何缓存图标文件，避免服务身份足迹泄露。
5. **日志脱敏**：任何凭据、派生密钥或解密数据绝不打印至 Wox 日志。

---

## 🛠️ 本地开发与构建

### 准备环境

- Node.js (推荐 v20+)
- pnpm
- Make

### 常用命令

```bash
# 1. 安装项目依赖
make install

# 2. 运行代码检查
make lint

# 3. 运行自动化测试套件
make test

# 4. 构建插件代码 (ncc + babel 输出到 dist/)
make build

# 5. 持续监听与热编译开发
make dev

# 6. 打包为 wox.plugin.keepass.wox
make package
```

---

## 📄 License

MIT © [Myraxion](https://github.com/Myraxion/Wox.Plugin.Keepass)
