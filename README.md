# 合成吴琨石 · SUIKA

一个单文件网页版「合成大西瓜」，材料是 8 张吴琨石的照片——**数字越小越大、越难合成**。

![游戏截图](gameplay.png)

## 玩

- 在线玩：**https://xiudaowuji.github.io/wukunnshi/**
- 仓库：https://github.com/xiudaowuji/wukunnshi
- 本地：下载 `index.html` 双击即可，不需要联网、不需要装任何东西

### 操作

| 平台 | 操作 |
|---|---|
| 电脑 | 鼠标拖动瞄准、松手投放；`←` `→` 移动、`空格` 投放、`R` 重开、`M` 静音 |
| 手机 / 平板 | 按住拖动瞄准、松手投放 |
| 通用 | 界面自适应横竖屏，最高分存本地 |

### 两个开关

右上角 `⚙`（手机上在底部）随时打开，设置会记在本地：

- **大弹跳** —— 球落地弹得更欢、更滑（弹性 0.07 → 0.42 左右，墙面也更弹）
- **双 1 号消除** —— 关掉后两颗吴琨石只是普通碰撞，不再「双石合一」

## 规则

两块**相同**的吴琨石相撞就合成下一号（8+8→7 … 2+2→1），数字越小越难合成。
每次随机掉落 **8 / 7 / 6 / 5 号**（权重 45 / 30 / 17 / 8），所以偶尔会天降大球。
两块 1 号相撞 =「双石合一」，双双消失并 +2000（可在开关里关掉）。
堆过虚线并停住约 1.3 秒 → 罐子满了，结算。

> 难度说明：球体半径整体偏大（1 号直径占罐子宽度一半以上），罐子很快就堆满，属于偏难的版本。

| 编号 | 名字 |
|---|---|
| 8 | 朦胧石 |
| 7 | 低头石 |
| 6 | 贴脸石 |
| 5 | 侧颜石 |
| 4 | 红瓦屋顶石 |
| 3 | 黑帽笑石 |
| 2 | 全副武装石 |
| 1 | **吴琨石** |

## 排行榜

开始界面有「排行榜」入口；结算面板点「记录排行」，输入用户名就能把本局分数传上去。规则是**同名只保留最高分**，重名直接覆盖，同分时先达到的人排前面。

两种模式，界面完全一样：

| 模式 | 数据在哪 | 触发条件 |
|---|---|---|
| 本机演示（默认） | 只存在本机 localStorage | 构建时不传 `--lb-api` |
| 云端排行 | Cloudflare Worker + D1 | 构建时传 `--lb-api=https://xxx.workers.dev` |

云端后端的部署步骤见 [server/README.md](server/README.md)，一个免费 Workers 账号就够，不用自己买服务器。

```bash
python build/build.py index.html --lb-api=https://wukunnshi-leaderboard.你的子域.workers.dev
```

> 分数是客户端算的，服务端只能校验范围和提交频率，拦不住直接改代码刷分——自己人玩够了，真要做反作弊就得把游戏逻辑搬到服务端跑。

## 实现

- 物理：Matter.js 0.20（内联进单文件，circle body + sleep）
- 渲染：Canvas 2D 自绘，圆形裁切照片、按等级配色的细描边、合成粒子 / 扩散环 / 飘字
- 音效：WebAudio 现场合成，无音频文件
- 交互：Pointer Events，`touch-action:none` 防止页面跟着滚动
- 版面：罐子高度固定 620 逻辑单位，宽度按窗口比例在 340~480 自适应
- 依赖：整个游戏就一个 ~247 KB 的 HTML；不点排行榜就不发任何请求

## 重新打包

```bash
python build/prep_images.py          # 裁切 8 张人像 -> build/images.json
python build/build.py index.html     # 模板 + Matter.js + 图片 -> index.html
node build/test_logic.js             # 逻辑自检（30 项）
node server/test_worker.mjs          # 排行榜后端自检（22 项，用 node:sqlite 冒充 D1）
```

- 改名字 / 大小 / 分数：`build/game.template.html` 里的 `LVL` 表
- 改掉落概率：同文件里的 `DROP_POOL`
- 改开关的弹性数值：同文件里的 `restOf` / `fricOf` / `wallRest`
- 换代照片：改 `build/prep_images.py` 里的 `SPEC`（每张图的裁切中心与缩放）
- 改排行榜上限 / 名字长度：`build/game.template.html` 里的 `LB_MAX_NAME` / `LB_MAX_SCORE`，以及 `server/worker.js` 顶部的同名常量（两边要一致）

## License

代码 MIT。照片是朋友的照片，请勿外传他用。
