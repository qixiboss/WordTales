# WordTales

一个把英语词汇放回语境中学习的静态单页应用。项目收录 **7 份词集、28 个主题栏目、897 个原始出现项、892 个规范学习词条和 132 个短文段落**。

默认首页是打开即学的单词卡；原文章主页保留在右上角“文章学习”。项目没有构建步骤，所有资源和 FSRS-6 调度器都随站点打包，可离线或通过 `file://` 使用。

## 主要功能

- **三档回忆评分**：我认识 → `Good`、提示后想起 → `Hard`、没想起来 → `Again`。
- **FSRS-6 调度**：使用随站点打包的 `ts-fsrs`，目标保持率 90%，关闭模糊间隔和同日重复。
- **到期优先队列**：每轮最多 20 词，每天最多引入 40 个新词；当天答过的词不重复。
- **中断恢复**：每次评分立即保存；刷新后恢复原轮次、原顺序和答案页，重复提交保持幂等。
- **规范词条**：897 个文章出现项映射到 892 个学习词条；跨文章同义词共享状态，不同词义的两个 `brisk` 独立。
- **统一生词状态**：学习卡、文章、分类游戏、生词抄写、热力图和统计统一读取规范词条的 `isStarred`。
- **语境阅读与朗读**：28 个栏目提供原创短文、预生成 MP3、逐词高亮、段落解析和系统语音降级。
- **旧主页工具**：词卡、文章点词、全部词/生词游戏、桌面拼写和移动端手写继续可用。
- **响应式与打印**：学习卡、总结、进度面板、旧文章主页均支持桌面端和移动端。

## 快速开始

直接打开：

```text
vocab-essays/vocab-essays.html
```

或在仓库根目录启动静态服务器：

```bash
python3 -m http.server 8000
```

然后访问 `http://localhost:8000/vocab-essays/vocab-essays.html`。

路由约定：

- 空 hash 或 `#study`：单词学习主页。
- `#library`：旧文章主页。
- `#s1col1` 等栏目 hash：直接进入对应文章。
- 词集和更新日志原有 hash 继续可用。

## 学习流程

1. 卡片初始只显示英文、来源、发音、“我认识”和“提示一下”。
2. “我认识”直接记录 `Good`；“提示一下”只显示原文句子，不提交结果。
3. 提示后选择“想起来了”记录 `Hard`，选择“没想起来”记录 `Again` 并加入生词。
4. 答案页显示词性、释义、语境、下次复习时间和星标状态，点击“下一个”后才切卡。
5. 一轮结束后查看三档统计、正确回忆率、新词/复习词数量，并继续下一轮或进入相关文章。

到期词按逾期时长、遗忘次数、FSRS 回忆概率、难度、最近复习时间和原始词序排序。到期词不足 20 个时才补新词；两池按保持内部顺序的方式交错展示。

## 内容概览

| 词集 | 栏目 | 出现项 | 段落 |
| --- | ---: | ---: | ---: |
| 第一份 | 4 | 131 | 16 |
| 第二份 | 4 | 115 | 16 |
| 第三份 | 5 | 169 | 24 |
| 第四份 | 4 | 130 | 21 |
| 第五份 | 4 | 136 | 24 |
| 第六份 | 4 | 130 | 18 |
| 第七份 | 3 | 86 | 13 |
| **合计** | **28** | **897** | **132** |

## 项目结构

```text
.
├── .github/workflows/jekyll-gh-pages.yml
├── scripts/check-integrity.js
├── vocab-essays/
│   ├── audio/                         # 栏目朗读 MP3
│   ├── css/styles.css                 # 两套主页、交互和响应式样式
│   ├── vendor/ts-fsrs/                # 官方 UMD 包、元数据与 MIT 许可证
│   ├── js/
│   │   ├── namespace.js               # WordTales 命名空间
│   │   ├── data.js                    # 内容、出现项和规范词条索引
│   │   ├── renderer.js                # 旧文章主页 DOM
│   │   ├── learning-progress-v2.js    # FSRS、迁移、事件和统一星标
│   │   ├── study-session.js           # 学习队列、卡片状态机和恢复
│   │   └── features.js                # 文章、朗读、游戏、抄写和路由
│   └── vocab-essays.html
├── CLAUDE.md
├── LICENSE
└── README.md
```

经典脚本使用 `defer` 按依赖顺序加载：

```text
ts-fsrs UMD
  → namespace
  → data
  → renderer
  → learning-progress-v2
  → study-session
  → features / App.init
```

## 公共接口

`WordTales.Data`：

- `resolveEntryId(occurrenceId)`
- `getEntry(entryId)`
- `getContexts(entryId)`
- `getAllEntries()`

`WordTales.LearningProgress`：

- `rateWord(entryId, rating, meta, submissionId)`
- `getDueEntries(at)`
- `getEntryState(entryId)`
- `getStarredEntryIds()` / `setStarred(entryId, value, meta)`
- `trackWord()`（旧功能兼容适配器）

`WordTales.StudySession`：

- `init()` / `activate()` / `deactivate()`
- `generateRound()`
- `openArticleReview(columnId)`

## 数据保存与迁移

学习档案和事件优先保存在 IndexedDB。v1 档案会幂等迁移为规范词条状态：保留既有到期时间，合并重复词记录，并把旧字符串星标映射到同拼写的规范词条。新档案中的 `isStarred` 是唯一事实来源；`localStorage.starredWords` 只作为旧功能兼容镜像。

浏览器无法使用 IndexedDB 时自动降级到 localStorage，并在学习卡中给出非阻塞提示。评分提交 ID 由轮次、词条和尝试次数组成，可防止刷新或连点造成双重调度。

## 验证

运行零依赖完整性检查：

```bash
node scripts/check-integrity.js
```

检查包括脚本语法、资源路径、897→892 映射、五组同义合并、两个 `brisk` 独立、所有词条语境和来源顺序、FSRS-6 版本与三档间隔，以及音频 cue 完整性。

手动 smoke test 应覆盖：默认学习页、三条评分路径、刷新恢复、总结页、自动发音授权、文章回跳、统一星标、游戏范围、抄写、旧主页深链、桌面和窄屏布局，以及 `file://` 打开。

## 部署

GitHub Pages 工作流会复制 HTML、CSS、JavaScript、音频、`vendor/` 和 README 到 `_site`。不运行 Jekyll，不从 CDN 下载运行时依赖。

`ts-fsrs` 按 MIT 许可证分发，许可证文本位于 `vocab-essays/vendor/ts-fsrs/LICENSE`。
