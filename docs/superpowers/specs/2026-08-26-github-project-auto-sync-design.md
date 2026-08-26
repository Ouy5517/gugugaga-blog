# GitHub 项目自动同步设计

## 背景与目标

博客已经使用 `src/content/projects/*.md` 管理项目卡片，并提供了 `npm run sync:github` 脚本。当前同步需要手动执行，Netlify 只有在博客仓库发生变化时才会构建，因此项目仓库自身的提交不会自动反映到博客。

本设计将同步动作放入博客仓库的 GitHub Actions：定时任务或手动触发任务读取已标记 `githubSync: true` 的项目，更新 GitHub 派生元数据，并在确有变化时提交回博客 `main` 分支。该提交继续触发现有 Netlify 部署，从而形成“GitHub 项目更新 → 博客仓库同步提交 → Netlify 发布”的稳定链路。

## 范围

### 包含

- 为 `githubSync: true` 的项目读取 GitHub REST API 仓库信息。
- 同步仓库描述、仓库链接、仓库状态、Star 数、Fork 数和最近推送日期。
- 支持 GitHub Actions 定时运行和 `workflow_dispatch` 手动运行。
- 只有同步结果产生实际差异时才提交，避免空提交和无意义的 Netlify 构建。
- 通过 Actions 日志报告仓库不存在、权限不足和 API 限流等失败原因。
- 保留现有手动维护的项目标题、技术栈、详细介绍、配图和精选状态。
- 为同步解析、字段更新和 workflow 配置补充自动化测试。

### 不包含

- 不在访客浏览器中直接请求 GitHub API。
- 不从项目仓库读取 README 并覆盖博客正文。
- 不为每个项目仓库创建 webhook、Personal Access Token 或额外 workflow。
- 不引入数据库、CMS 或新的运行时后端。
- 不改变文章同步、Decap CMS 或现有 Netlify 域名配置。

## 方案与取舍

采用博客仓库内的 GitHub Actions 定时同步，而不是浏览器运行时请求或逐仓库 webhook。

- 定时同步将 GitHub API 请求集中在受控的 CI 环境，访客不消耗 API 配额。
- 同步后的字段写回 Markdown，继续兼容当前静态构建、SEO、RSS 和站点地图。
- GitHub Actions 自带 `GITHUB_TOKEN`，不需要保存个人访问令牌；工作流仅授予 `contents: write`，并只在检测到差异后提交。
- 代价是项目数据最多延迟一个同步周期。手动触发入口用于需要立即更新的场景。

## 数据模型与字段所有权

项目 Markdown 继续使用当前 Front Matter。字段所有权如下：

| 字段 | 来源 | 同步行为 |
| --- | --- | --- |
| `name` | 本地 | 作为仓库名提示；若 URL 可解析则以 URL 中的仓库名为准 |
| `title` | 本地 | 永不覆盖 |
| `description` | GitHub description | 用 GitHub 描述更新；GitHub 描述为空时保留本地值 |
| `detail` | 本地 | 永不覆盖 |
| `stack` | 本地 | 永不覆盖 |
| `url` | GitHub API | 规范化为仓库 HTML 地址 |
| `status` | GitHub `archived` 与 `pushed_at` | 归档、进行中或维护中 |
| `featured`、`image`、`draft` | 本地 | 永不覆盖 |
| `githubSync` | 本地 | `true` 才参与同步 |
| `githubStars`、`githubForks`、`githubUpdated` | GitHub API | 每次同步更新 |

仓库定位优先使用项目 `url` 中的 owner/repository，避免将来同步非 `Ouy5517` 的公开仓库时请求错误。若 URL 无法解析，则兼容使用 `GITHUB_USERNAME` 环境变量和 `name` 字段；无法确定仓库时跳过该文件并输出可读警告。

## 组件与接口

### 同步脚本

`scripts/sync-github-projects.mjs` 是唯一的同步入口，`npm run sync:github` 继续调用它。脚本应：

1. 读取 `.env` 和进程环境中的 `GITHUB_TOKEN`，无令牌时使用公开 API 请求。
2. 扫描项目 Markdown，筛选 `githubSync: true`。
3. 解析每个项目的 GitHub owner/repository。
4. 先完成所有 API 请求和字段变换，再一次性写入变更文件，避免中途失败留下部分同步结果。
5. 对字段进行稳定序列化，只改动受同步字段，保留正文和其他 Front Matter 顺序。
6. 输出同步数量；没有变化时正常退出，不伪造文件修改。

每个仓库调用 `GET /repos/{owner}/{repo}`，请求头包含 `Accept: application/vnd.github+json`、`X-GitHub-Api-Version: 2022-11-28` 和固定 User-Agent。非 2xx 响应应包含 HTTP 状态、仓库地址和限流配置提示；脚本以非零状态退出，交给 workflow 阻止提交。

### GitHub Actions 工作流

新增 `.github/workflows/sync-github-projects.yml`，触发方式为：

- `schedule`：每 6 小时运行一次。
- `workflow_dispatch`：允许维护者从 Actions 页面立即运行。

工作流固定在 `main` 分支执行，步骤为：检出仓库、设置 Node.js 20、执行 `npm run sync:github`、检查 `git diff`、仅在存在差异时以 `github-actions[bot]` 身份提交并推送。工作流权限为 `contents: write`，不读取或写入其他 Secret。`GITHUB_TOKEN` 通过 Actions 默认环境提供，不写入仓库文件。

由于 GitHub 使用 `GITHUB_TOKEN` 推送的提交不会再次触发同一类 workflow，且脚本只在有差异时提交，因此不会形成循环构建。

### Netlify 链路

不新增 Netlify Function 或定时器。同步提交进入 `main` 后，现有 GitHub 集成执行 `npm run build`，构建产物自然包含最新项目元数据、RSS 和站点地图。手动执行 workflow 后通过 Netlify 的部署记录确认发布。

## 错误处理与安全性

- GitHub API 限流（403）时终止本次同步，并提示配置 `GITHUB_TOKEN`；不提交不完整结果。
- 仓库不存在或无权访问时终止本次同步并指出具体仓库；不静默删除本地项目。
- GitHub 返回空描述时保留本地 `description`，防止卡片变成空白。
- 工作流只允许同步公开仓库元数据，不执行仓库代码，不读取 README 或项目文件。
- 所有第三方 Actions 使用固定 commit SHA，避免供应链版本漂移。
- 推送失败时 workflow 失败，保留本地仓库当前状态，下一次定时或手动运行可重试。

## 测试策略

### 单元测试

- 解析标准 GitHub URL、带尾斜杠 URL 和带 hash/query 的 URL。
- URL 中 owner 与 repository 的提取优先级。
- GitHub 响应到 Front Matter 字段的映射，包括归档、活跃和长期未更新状态。
- 空描述回退到本地描述。
- 无 `githubSync` 项目不发起请求、不写文件。
- API 错误包含状态码与仓库标识，并以失败状态结束。
- 同步后正文、标题、技术栈和其他本地字段保持不变。

### 集成验证

- 解析 workflow 结构，确认定时和手动触发、权限、Node 版本、差异检查和提交条件。
- 运行现有前端测试和生产构建，确保项目卡片、SEO、RSS 和站点地图没有回归。
- 在 GitHub 上手动触发 workflow，确认一次“有变化提交”和一次“无变化不提交”。
- 确认同步提交触发 Netlify 部署，并在生产项目区看到最新 Star/Fork/更新时间。

## 验收标准

1. 修改任一已登记 GitHub 项目并推送后，最多 6 小时内博客仓库出现同步提交；维护者也可手动触发立即同步。
2. 博客首页项目卡片显示同步后的描述、状态、Star、Fork 和最近更新时间。
3. 项目 Markdown 中手动维护的标题、技术栈、详细介绍、配图和正文未被覆盖。
4. GitHub API 失败时不会产生部分提交，Actions 日志能定位失败原因。
5. 无变化时不创建提交，不触发额外 Netlify 部署。
6. 现有前端测试、同步脚本测试和生产构建全部通过。

## 发布与回滚

先合并同步脚本和 workflow，再从 Actions 页面手动运行一次验证。若同步结果不符合预期，可回滚最近一次 bot 提交；删除或暂停 workflow 不影响现有静态项目数据，博客仍会使用最后一次成功构建的内容。
