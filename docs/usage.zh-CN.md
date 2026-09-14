# pi-anki-flash 中文使用指南

pi-anki-flash 把 Anki 复习界面和管理工具带进 pi。你可以在终端中复习，也可以在对话中查牌组、制作卡片、查看统计，并为单个牌组调整目标保留率和学习计划。

所有卡片读写和评分都通过 AnkiConnect 完成。复习评分会进入 Anki 的真实调度记录，之后可以正常同步到 AnkiWeb。

## 安装与启动

使用前需要：

1. 安装并打开 Anki Desktop。
2. 在 Anki 中安装 AnkiConnect，插件代码为 `2055492159`。
3. 保持 Anki Desktop 运行。
4. 安装 pi 插件并重启 pi：

```bash
pi install git:github.com/WASIDJ/pi-anki-flash
```

进入 pi 后运行：

```text
/anki-stats
```

如果能看到牌组和待复习张数，说明连接成功。默认连接地址是 `http://127.0.0.1:8765`。

开发本地版本时，可以直接加载工作区：

```bash
pi -e ./extensions/anki-flash/index.ts
```

或者安装本地目录：

```bash
pi install /absolute/path/to/pi-anki-flash
```

不要同时启用 Git 版本和本地版本，否则命令和工具可能重复注册。

## 在终端中复习

打开 Pi 复习界面：

```text
/anki
```

随后从选择器中选择牌组。选择器会显示每个牌组的新卡、学习中和待复习张数，并优先显示当前任务量较多的牌组。确认后，插件会让 Anki 切换到该牌组并开始复习。

也可以按 `Ctrl+Shift+K` 快速打开。复习界面会显示新卡、学习中、待复习、牌组总数和当前卡片状态。显示答案后，每个评分旁会显示 Anki 计算的下次复习间隔。

| 按键 | 操作 |
| --- | --- |
| `Space` | 显示答案并播放答案音频 |
| `1` | 重来（Again） |
| `2` | 困难（Hard） |
| `3` | 良好（Good） |
| `4` | 简单（Easy） |
| `r` | 重播音频 |
| `u` | 撤销上一次评分 |
| `s` | 暂停或恢复当前卡片 |
| `b` | 进入或退出浏览模式 |
| `j` / `k` | 浏览模式中切换卡片 |
| `a` | 在当前牌组添加卡片 |
| `q` / `Esc` | 关闭界面 |

张数来自 Anki 的牌组统计，不代表本次会话固定的进度总数。评分、撤销、暂停或添加卡片后，统计会重新读取。

## 常用斜杠命令

| 命令 | 用途 |
| --- | --- |
| `/anki` | 选择牌组并打开复习界面 |
| `/anki-stats [牌组]` | 查看新卡、学习中和待复习统计 |
| `/anki-browse <查询>` | 使用 Anki 查询语法搜索卡片 |
| `/anki-add 正面 \| 背面 \| 牌组` | 添加 Basic 卡片 |
| `/anki-newdeck <名称>` | 创建牌组 |
| `/anki-config` | 查看插件配置 |
| `/anki-config <键> <值>` | 修改插件配置 |
| `/anki-sim [牌组]` | 估算不同目标保留率的复习量 |

搜索示例：

```text
/anki-browse deck:AIInfra is:due
/anki-browse tag:pi added:1
```

## 在对话中制作卡片

直接告诉 pi：

```text
把刚才关于有限理性的内容整理成 Anki 卡片，放到“有限理性”牌组。
```

插件附带的制卡工作流会先展示草稿表格。你可以修改、删除或批准其中一部分；只有明确批准后，agent 才会写入 Anki。agent 制作的卡片会带 `pi` 标签，之后可以搜索：

```text
/anki-browse tag:pi
```

每张卡保存后，可以为下一张卡选择一个关系方向：

- 原因与机制
- 前置概念
- 对比与辨析
- 应用与例子
- 边界与反例
- 后果与影响
- 原文下一个重点
- 自定义问题或方向
- 结束制卡

Pi 每次只生成一张相关卡，并继承已经选择的 Deck、Template 和 Tags。相邻卡片可以形成
知识联系，但每张卡的问题仍会明确写出概念，保证它在 Anki 随机出现时也能独立回答。

更好的请求通常会说明牌组、卡片数量和知识范围，例如：

```text
把上面的定义制作成 5 张卡，每张只考一个知识点，答案控制在一句话内，放入“经济学”牌组。
```

当前对话制卡默认使用 Basic 笔记类型；也可以由 agent 指定其他已有笔记类型。图片、音频和复杂自定义字段仍建议在 Anki 中检查。

## 在对话中设置单个牌组的学习计划

可以读取真实的 Anki 牌组预设：

```text
查看 AIInfra 当前的复习策略，以及哪些牌组与它共用预设。
```

可以先做只读预览：

```text
预览把 AIInfra 的目标保留率改成 95%，不要保存。
```

也可以明确要求应用：

```text
把 AIInfra 的 FSRS 目标保留率设为 90%，每天新卡 10 张，复习上限 200 张。
```

支持的设置如下：

| 对话中的设置 | 工具字段 | 有效范围 |
| --- | --- | --- |
| FSRS 目标保留率 | `desiredRetention` | `0.70`–`0.99`，90% 写作 `0.9` |
| 每日新卡上限 | `newCardsPerDay` | `0`–`9999` |
| 每日复习上限 | `reviewsPerDay` | `0`–`9999` |
| 学习步骤 | `learningStepsMinutes` | 小于一天的正数分钟数组 |
| 重新学习步骤 | `relearningStepsMinutes` | 小于一天的正数分钟数组 |

例如“学习步骤设为 1 分钟和 10 分钟”对应 `[1, 10]`。空数组表示不配置固定的短期步骤，由兼容版本的 Anki/FSRS 处理短期调度。

### 预设隔离规则

Anki 的调度设置属于“预设”，多个牌组可能共享同一个预设。为了只修改指定牌组：

- 如果它使用 Default 或与其他牌组共享预设，插件会先复制预设，再只分配给目标牌组。
- 如果它已经使用独立预设，插件会直接更新该预设。
- 子牌组不会自动改用新预设，需要分别指定。
- 未请求修改的字段和已有 FSRS 权重会保留。
- 保存后会重新读取并验证；失败时会尝试恢复原设置。

AnkiConnect 没有提供原子事务，因此工具运行期间不要同时在 Anki 界面编辑同一个预设。

### FSRS 的边界

目标保留率保存为 `0.9`，只表示该预设的目标是 90%。你仍需在 Anki 的牌组选项中启用 FSRS。当前插件不能：

- 判断或切换整个 Anki 集合的 FSRS 开关；
- 自动优化 FSRS 权重；
- 修改设置后批量重新调度已有卡片；
- 设置“仅今天”或单牌组覆盖值。

每日上限目前修改的是预设值。Anki 中的单牌组覆盖、仅今天覆盖及父牌组上限仍可能影响实际张数。

`/anki-sim 牌组名` 只是工作量估算，不会修改任何设置。

## 插件配置

配置保存在 `~/.pi/agent/settings.json` 的 `ankiFlash` 字段下，也可以用 `/anki-config` 修改。

```json
{
  "connectUrl": "http://127.0.0.1:8765",
  "defaultDeck": null,
  "deckPriority": [],
  "autoOpen": {
    "enabled": false,
    "cooldownMin": 30,
    "onlyWhenDue": true
  },
  "media": {
    "playAudio": true,
    "renderImages": true,
    "maxImageWidthCells": 40,
    "maxImageHeightCells": 30
  },
  "review": {
    "allowBrowsingInModal": true,
    "showCounts": true,
    "showCardState": true,
    "showNextReviews": true
  },
  "sim": {
    "retentions": [0.8, 0.85, 0.9, 0.95],
    "historyDays": 30
  }
}
```

常用设置：

```text
/anki-config defaultDeck 有限理性
/anki-config deckPriority ["有限理性","AIInfra"]
/anki-config autoOpen.enabled true
/anki-config review.showCounts false
/anki-config review.showCardState false
/anki-config review.showNextReviews false
```

## 图片与音频

Ghostty、Kitty、WezTerm 和 iTerm2 等支持图像协议的终端可以内联显示图片。在 tmux 中或不支持图像协议时，会显示 `[image: 文件名]`。

音频目前使用 macOS 的 `afplay`。Linux 用户需要修改实现，替换成 `mpv` 或 `aplay`。

## 常见问题

### 提示 AnkiConnect unreachable

确认 Anki Desktop 已打开、AnkiConnect 已安装，并在浏览器或终端中检查 `127.0.0.1:8765` 是否可访问。如果修改过地址，请检查：

```text
/anki-config connectUrl http://127.0.0.1:8765
```

### 更新后仍看不到新功能

重启 pi。然后运行 `pi list`，确认只安装了一个 pi-anki-flash 来源。开发时如果安装的是 Git 版本，本地未提交的修改不会自动进入已安装副本；可以改为安装本地目录。

### `/anki` 中没有显示目标牌组

选择器直接读取 AnkiConnect 返回的牌组。请确认牌组已在 Anki 中创建，并保持 Anki Desktop 与 AnkiConnect 正常运行。

### 修改目标保留率后间隔没有立即变化

当前工具不会批量重新调度旧卡片。新设置会参与之后的调度；是否重新调度既有卡片，请在 Anki 的牌组选项中操作并确认影响范围。

## 开发与验证

```bash
npm install
npm test
npx tsc --noEmit
```

测试使用模拟的 AnkiConnect，不会修改真实 Anki 集合。
