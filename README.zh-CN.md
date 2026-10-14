# pi-anki-flash

[English](README.md) | 简体中文 | [完整使用指南](docs/usage.zh-CN.md)

面向 [Pi coding agent](https://pi.dev/) 的 Anki 客户端与对话制卡工作流。
你可以直接把当前对话变成经过确认的 Anki 卡片，也可以在终端内复习、搜索卡片、
查看牌组统计并估算 FSRS 工作量。

所有卡片和复习操作都通过
[AnkiConnect](https://ankiweb.net/shared/info/2055492159) 完成，因此使用 Anki 的
真实调度器，并能正常同步到 AnkiWeb。

## 主要功能

- 根据当前对话制卡，支持自动或手动选择笔记类型（template）。
- 每张生成的卡片写入前都必须预览确认：`y` 保存，`n` 跳过。
- 支持自然语言修改建议，也能直接编辑字段、tags、笔记类型和目标牌组。
- 优先复用 Anki 中已有的 tags，并为 Pi 创建的卡片自动添加 `pi`。
- 可以在牌组选择器中直接创建牌组和子牌组。
- 使用真实字段支持 Basic、Cloze、Markdown 及自定义笔记类型。
- 支持通过 Markdown/HTML 嵌入图片或传入本地文件、远程 URL，自动上传到 `collection.media`；Image Occlusion 会明确拒绝并给出替代方案。
- 明确要求时可跳过逐卡预览批量直接写入，并自动 sync 到其他设备。
- 在终端浮层中复习和评分，评分结果直接进入 Anki 调度器。
- 搜索卡片、查看到期数量，并进行只读的 FSRS 工作量模拟。

## 使用条件

- Node.js 20 或更高版本，以及可用的 Pi。
- Anki Desktop 正在运行，并安装 AnkiConnect（插件代码 `2055492159`）。
- 默认连接地址为 `http://127.0.0.1:8765`，可通过 `ankiFlash.connectUrl` 修改。
- Ghostty、Kitty、WezTerm 和 iTerm2 支持行内图片；其他终端显示图片占位符。
- 音频播放目前使用 macOS 的 `afplay`。

## 安装

```bash
pi install git:github.com/WASIDJ/pi-anki-flash
```

如果 Pi 已经打开，请执行 `/reload`。使用期间需要保持 Anki Desktop 运行。

## 在对话中制卡

直接告诉 Pi：

```text
把刚才讲的内容 make card。
把这个解释拆成两张 Anki 卡片。
帮我制卡，我想手动选择 template。
这张卡使用 Anki Markdown Cloze。
```

也可以使用 `/make-card [要求]` 自动选择笔记类型，或使用
`/make-card manual [要求]` 先手动选择笔记类型。

Pi 会从正在运行的 Anki 中读取真实的笔记类型、字段名、牌组和 tags，然后逐张生成
草稿并打开预览。只有在预览中按下 `y`，卡片才会写入 Anki。

保存后会出现“下一张卡想探索哪个方向？”选择器。可以选择原因与机制、前置概念、
对比与辨析、应用与例子、边界与反例、后果与影响、原文下一个重点，也可以输入自定义
问题、补充材料或方向，也可以结束制卡。下一张卡会继承当前 Deck、Template 和 Tags，
并保持问题可以独立复习。预览时按 `c` 可以保存当前卡并直接打开自定义下一张输入框。

| 按键 | 操作 |
| --- | --- |
| `y` | 保存当前卡片 |
| `c` | 保存并输入下一张卡的问题、补充材料或方向 |
| `n` / `Esc` | 跳过当前卡片 |
| `r` | 用自然语言提出修改建议，等待 Pi 重写后再次预览 |
| `e` | 以 JSON 直接编辑实际字段 |
| `t` | 更换 Anki 笔记类型，并按新字段重新生成 |
| `g` | 修改建议的 tags |
| `d` | 更换或新建目标牌组 |
| `↑` / `↓`、`j` / `k` | 滚动较长内容 |

预览顶部固定显示牌组、笔记类型、建议 tags 和最近一次修改要求。字段中的 HTML
会以易读文本显示，保存时仍保留原始 HTML。创建子牌组时使用 `::`，例如
`语言::英语`。牌组会立即创建，因此之后即使跳过卡片，Anki 中仍会保留空牌组。

使用 `/anki-browse tag:pi added:1` 可以查找今天由 Pi 创建的卡片。

### 卡片中使用图片

图片可以放在任何字段中：Markdown `![alt](路径或 URL)`、HTML `<img src="...">`，
或携带 `images` 参数（支持 `path`、`url`、可选 `filename` 和目标 `field` ）。
无论是本地文件（支持 `~` 路径）还是远程 `http(s)` URL，都会被自动上传到
Anki 的 `collection.media` 并重写字段为存储后的文件名。终端文本预览中显示为
`[图片: 文件名]` 占位符；在支持行内图片的终端中，复习浮层会真实渲染图片。

**不支持 Image Occlusion 笔记类型** —— Anki 原生的图片遮挡依赖桌面端
GUI 画布和交互式遮挡坐标。需要图片回忆卡时请使用 `Basic` 或 `Anki Markdown`
把图片放在正面，或在图片下加 Cloze。误用 `Image Occlusion` 会收到明确的
错误提示。

### 无审核的批量制卡

当明确要求（例如“直接制卡”“不需要确认”“不用审核”）时，Pi 会跳过每张卡的交互
预览，直接通过 AnkiConnect API 写入卡片，并一定以 `sync` 结束让其他设备同步收到。
默认使用 `Anki Markdown` 笔记类型。未经明确要求时，每张卡片依然走 `y/n` 预览流程。

### 与 pi-permission-system 配合

`anki_add_note` 内部已经强制执行卡片预览和确认。如果安装了
`pi-permission-system`，可以允许这个工具，避免进入预览前再次出现通用权限窗口：

```json
{
  "permission": {
    "anki_add_note": "allow"
  }
}
```

其他工具的权限互不影响。

## 复习卡片

使用 `/anki` 或 `Ctrl+Shift+K` 后，先在选择器中挑选牌组。选择器会显示每个牌组的
新卡、学习中和待复习张数；确认后插件会让 Anki 切到该牌组，再打开复习浮层。

| 按键 | 操作 |
| --- | --- |
| `Space` | 显示答案并重播音频 |
| `1`–`4` | 通过 Anki 评分：Again / Hard / Good / Easy |
| `r` | 重播音频 |
| `u` | 撤销上一次评分 |
| `s` | 暂停或恢复当前卡片 |
| `b` | 切换浏览模式，使用 `j` / `k` 移动 |
| `a` | 打开简单的 Basic 制卡表单 |
| `q` / `Esc` | 关闭浮层 |

每个区域最多显示 30 行图片或 60 行文本；出现截断提示时可在 Anki 中查看完整内容。

## 命令

| 命令 | 用途 |
| --- | --- |
| `/make-card [要求]` | 根据对话生成并确认卡片 |
| `/make-card manual [要求]` | 生成前手动选择笔记类型 |
| `/anki` | 选择牌组并打开复习浮层 |
| `/anki-add "正面 \| 背面" [牌组]` | 直接添加简单的 Basic 卡片 |
| `/anki-browse <查询>` | 使用 Anki 搜索语法查找卡片 |
| `/anki-stats [牌组]` | 查看新卡、学习中和复习数量 |
| `/anki-newdeck <名称>` | 创建牌组 |
| `/anki-config [键] [值]` | 查看或修改插件设置 |
| `/anki-sim [牌组]` | 估算不同记忆率下的 FSRS 工作量 |

插件向 Pi 提供十个工具：

```text
anki_list_decks       anki_find_cards       anki_card_info
anki_deck_stats       anki_note_context      anki_add_note
anki_delete_notes     anki_suspend_cards     anki_set_config
anki_simulate_retention
```

## 配置

配置位于 `~/.pi/agent/settings.json` 的 `ankiFlash` 字段中，也可以通过
`/anki-config` 或 `anki_set_config` 修改：

```json
{
  "ankiFlash": {
    "connectUrl": "http://127.0.0.1:8765",
    "defaultDeck": null,
    "deckPriority": ["语言", "AIInfra"],
    "autoOpen": { "enabled": false, "cooldownMin": 30, "onlyWhenDue": true },
    "media": { "playAudio": true, "renderImages": true, "maxImageWidthCells": 40, "maxImageHeightCells": 30 },
    "review": { "allowBrowsingInModal": true },
    "sim": { "retentions": [0.8, 0.85, 0.9, 0.95], "historyDays": 30 }
  }
}
```

开启 `autoOpen.enabled` 后，Pi 每个会话最多自动打开一次复习浮层，同时遵守
`cooldownMin` 和 `onlyWhenDue`。

## FSRS 模拟

`/anki-sim [牌组]` 使用 FSRS-4.5 遗忘曲线反算公式
`I(S, DR) = S × (DR⁻² − 1) × 81/19` 估算复习量。它假设卡片稳定性不变，
将学习中的卡片作为固定工作量加入，并给出预计每日复习数。它不会修改 Anki 调度器。

## 开发与验证

```bash
pi -e ./extensions/anki-flash/index.ts
npm test
PI_ANKI_LIVE=1 npm test
node tests/rpc-smoke.mjs
```

- `npm test` 使用模拟的 Anki 响应和 Pi 的真实扩展加载器。
- `PI_ANKI_LIVE=1 npm test` 从运行中的 Anki 读取并预检笔记类型，但不会写入卡片。
- `node tests/rpc-smoke.mjs` 使用当前配置的 Pi 模型验证自动/手动选择、修改、预览与取消，全程不会批准写入。
- 如果 Pi 不在标准的全局 Node 路径中，请设置 `PI_PACKAGE_DIR`。

## 许可证

MIT
