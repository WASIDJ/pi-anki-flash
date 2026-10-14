# Handoff: pi-anki-flash 复习卡片图片在 ssh+tmux 下定位错乱/泄漏到相邻窗格

## 任务

修复 pi-anki-flash 复习 TUI 中卡片图片在 tmux passthrough 链路上的渲染缺陷：
**图片能透传显示，但被绘制到了错误的绝对位置，覆盖相邻 tmux 窗格的文本，且换卡片/切换窗格后旧图残留（一张图在多个位置重复出现）。**

## 环境链路

```
Ghostty (macOS 本机, kitty graphics 协议完整支持)
  → ssh mini-t  (100.88.205.23, macOS arm64)
    → 远端 tmux 3.6a, socket `-L default`, 会话 `vibe`, 3 窗格 (0/1/2)
      → pi (@earendil-works/pi-coding-agent) + pi-anki-flash 扩展
```

已确认（本会话验证过，勿重复排查）：

- 远端 `~/.tmux.conf`:`set -g allow-passthrough on` 已配置且服务器已加载（`tmux -L default show -g allow-passthrough` 返回 on）。
- 通过临时 tmux 窗口发 DCS 包裹的 kitty 查询序列（`a=q`），Ghostty 正确返回 `OK` —— 透传链路本身工作。
- 远端 shell 已 `export PI_IMAGE_PROTOCOL=kitty`（写入 `~/.zshrc`）。
- 远端扩展位于 `~/.pi/agent/git/github.com/WASIDJ/pi-anki-flash/`（git: 安装的 checkout），已与本地工作区同步。
- pi-tui 行为：检测到 `$TMUX` 时 `getCapabilities().images = null`（"unreliable under tmux"），需 `PI_IMAGE_PROTOCOL` 环境变量覆写；且 `encodeKitty` 从不做 tmux DCS 包裹。

## 已完成的改动（本次会话，未 commit —— 请先 commit）

`extensions/anki-flash/render.ts`：

1. 模块加载时：`$TMUX` 存在且 `PI_IMAGE_PROTOCOL` 为 kitty/iterm2 → `setCapabilityOverrides({ images: protocol })` 恢复图片能力；
2. 新增 `tmuxWrap()`：tmux 下将 renderImage 返回的序列包进 `\x1bPtmux;…\x1b\\`（ESC 双倍转义）；
3. `renderFirstImage()` 输出 `tmuxWrap(result.sequence)`。

本地 `npx tsc --noEmit` 通过，`npm test` 38 pass（skip 1 为原有）。

## 现有 bug（需要你解决）

截图证据：`/Users/Admin/Library/Application Support/com.raycast.macos/clipboard/file-668d8d327f777d52c9a2df72f893e97d.png`

复习 TUI 在 vibe 会话**窗格 2（DOWNLOAD）**中运行。现象：

1. 卡片图片（华为"十八层宝塔"半导体产业链表）被绘制到了**窗格 0（ANKI 卡片）的内容区**，覆盖其文本；
2. 窗格 2 中也出现同一张图的另一个位置；
3. 即：kitty 图像的 placement 把 tmux pane 内的行坐标当成了**整个终端窗口的绝对行坐标**（kitty 协议 a=T/p 放置按终端窗口坐标系计算，而 DCS 透传不经 tmux 改写坐标），于是左侧、右侧窗格同一 relative 位置各出现一份。

根因分析（明确给 codex 指向）：

- kitty 协议以"当前光标位置"或绝对行/列放置图像。DCS passthrough 下 tmux 原样转发，Ghostty 按**窗口级光标/坐标**绘
制。复习 UI 在窗格 2 的某行输出图像时，Ghostty 画在窗口的该行——而行号相同但列属于别的窗格 → 错位/串窗格。
- 旧图残留：pi-anki-flash 的 pi-tui 路径用 `allocateImageId()` + `registerKittyImageMetadata` 管理生命周期，换卡时发出新 imageId，旧 id 没被 delete（`a=d`），且 TUI 重绘时序列重发 → 多份副本。
- 已知上游条件：同链路下方式 yazi/kitten icat 之所以工作，是因为它们在全屏方式（tmux 把该窗格单独 repaint、光标始终在窗格内）或显式 delete 后再画。

## 修复方向（建议顺序，可取舍）

A. **切换/换卡时主动清理**：在任何重绘（显示新卡、转答案、退出复习）前，先发 kitty `a=d,d=i,I=<id>`（按 id 删除）序列（同样经 tmuxWrap），再画新图。确保一张卡只有一份图。
B. **防止坐标系错位**：选项 1) 复习 UI 绘制图片前，只允许在"当前 client 正在显示的窗格"渲染；选项 2) 把 image sequence 的行包装转变为放在输出时的光标行（a=p 用光标放置，去掉绝对行/列 c/r 参数，让正确从光标处落下），tmux 转发时光标恰好在该窗格正确位置；选项 3) 若 pane 不是 active/非当前窗格 → 退化为 `[image: name]` 占位。
C. **补充检测**：`renderFirstImage` 之前检测 `$TMUX` + pane 可见性（不可见 → 占位），避免不可见窗格输出图形序列。
D. （可选）将改动上游化：pi-tui 的 `encodeKitty` 在 `$TMUX` 下自动 DCS 包裹 + capability 检测改进；本仓 render.ts 的 `tmuxWrap` 可作为 PoC。

参考实现：yazi (flameshot: `yazi/adapters/image.rs` 与 `mux/mod.rs` 中 `tmux_wrap`)、kitten icat 的 tmux 检测、tmux `allow-passthrough` DCS 语义。

## 复现步骤

1. `ssh mini-t`（自动进入 tmux 会话 vibe，3 窗格布局）。
2. 在窗格 2 中：`pi` → `/anki` 复习 → 打开 `测试::图片制卡`（正面含图片 PNG）。
3. 观察：图片应只出现在窗格 2 的卡片问题区，且不覆盖其它窗格；翻到答案后图片位置正确/或被应答区替代；切到其它窗格再切回不重影、不残留。

## 验收标准

- [ ] 图片仅渲染在复习窗格内部区域，不越界到其它 tmux 窗格；
- [ ] 换卡/显示答案后旧图片被清理，终端无重影残留；
- [ ] 非 active 窗格或不支持环境下退化为 `[image: filename]` 占位符；
- [ ] 本地免 tmux（纯 Ghostty）渲染路径不变、全部测试通过；
- [ ] 改动 commit 并 push，远端 `~/.pi/agent/git/github.com/WASIDJ/pi-anki-flash/` 同步更新。

## 关键文件

- `extensions/anki-flash/render.ts` — `renderFirstImage()`、`tmuxWrap()`、`TMUX_IMAGE_PROTOCOL`（本次新增）
- pi-tui 参考：`node_modules/@earendil-works/pi-tui/dist/terminal-image.js`（`encodeKitty`/`renderImage`/`registerKittyImageMetadata`/`detectCapabilitiesFromEnvironment`）
- 远端环境文件：mini-t 的 `~/.tmux.conf`、`~/.zshrc`
