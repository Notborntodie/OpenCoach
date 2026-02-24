# OpenCoach 融入 gespgrowplan 方案

## 一、两个项目能力对照

| 能力 | gespgrowplan | OpenCoach |
|------|--------------|-----------|
| 题目与样例 | ✅ MySQL `oj_problems` / `oj_samples` | ❌ 静态 MOCK_PROBLEM |
| 真实判题 | ✅ isolate 沙箱，g++ 编译，verdict + error_message | ❌ 前端 mock 规则 |
| 评测结果 | ✅ Compilation Error / WA / RE / TLE / MLE / Accepted | ✅ 需用真实结果驱动 |
| 前端 | Vue 3 + CodeMirror | React + Monaco |
| AI 服务 | Al_server：PDF 提取、题解生成（DashScope） | 前端直连 LLM：苏格拉底引导、错误分层、名师锦囊 |
| 用户/任务 | ✅ 用户、学习计划、任务内提交 | ❌ 无 |

结论：**可以融合**。gespgrowplan 提供题目、真实评测、用户与任务；OpenCoach 提供「错误分层 + CE 翻译官 + 名师锦囊 + 求助教练」的教练逻辑与交互设计，以后端/新 AI 接口形式接入 gespgrowplan。

---

## 二、融合架构建议

```
┌─────────────────────────────────────────────────────────────────┐
│                    gespgrowplan 前端 (Vue 3)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐│
│  │ 题目列表/详情 │  │ 代码编辑器   │  │ 提交结果 + AI 助教面板    ││
│  │ (现有)       │  │ CodeMirror   │  │ (新增：聊天 + 引导话术)   ││
│  └──────────────┘  └──────────────┘  └──────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
        │                     │                        │
        ▼                     ▼                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                  backend_server (Node.js)                        │
│  GET /api/oj/problems, /api/oj/problems/:id                      │
│  POST /api/oj/submit → isolate 判题 → verdict + error_message     │
│  (可选) GET /api/coach/hints/:problemId  名师锦囊                │
│  (可选) POST /api/coach/ticket  求助教练工单                     │
└─────────────────────────────────────────────────────────────────┘
        │
        │ 若教练由后端代理
        ▼
┌─────────────────────────────────────────────────────────────────┐
│  Al_server (Python/FastAPI) 或 新增 Node 教练接口                  │
│  POST /api/coach/guide  (code, verdict, error_message, problem)   │
│  → 错误分层(CE/RE/WA/TLE) → 注入名师锦囊 + 报错 RAG → 调 DashScope │
│  → 流式返回引导回复                                               │
└─────────────────────────────────────────────────────────────────┘
```

- **不把 OpenCoach 的 React 前端整体嵌进 Vue**，而是在 gespgrowplan 的 OJ 题目页**新增「AI 助教」面板**（Vue 组件），复用 OpenCoach 的交互与 Prompt 设计。
- **判题完全用现有流程**：提交走 `POST /api/oj/submit`（或你现有的 OJ 提交接口），拿到的 `verdict`、`error_message`、`results` 作为教练接口的输入。
- **教练逻辑**放在后端或 Al_server，前端只发「请求引导」和展示流式回复。

---

## 三、后端与判题侧（gespgrowplan 已有）

- **提交与判题**：`backend_server/routes/oj.js` 已用 `isolateJudge.judgeCode()`，返回 `verdict`（Accepted / Wrong Answer / Compilation Error / Time Limit Exceeded / Memory Limit Exceeded / Runtime Error / Partially Accepted）和每测例的 `error`。
- **编译错误**：`services/isolateJudge.js` 中 `compileCode` 在 g++ 失败时 `throw new Error('编译错误:\n${errorMsg}')`，上层会把该 message 写入 `oj_submissions.error_message`。
- **运行时错误**：isolate 的 meta 与 catch 会得到 TLE/RE/MLE 等，并写入 results 里各测例的 `error` 或提交的 `error_message`。

融合时只需保证：**提交结果接口**（或轮询单次提交详情的接口）向前端返回 **verdict**、**error_message**、以及可选的首个失败测例的 **error**（用于 RE/TLE 的详细说明）。现有数据库已有 `oj_submissions.verdict`、`error_message`、`results`，一般无需改表。

---

## 四、需要新增/改动的部分

### 1. 名师锦囊与题目元数据（配置或接口）

- **方案 A**：在 gespgrowplan 仓库中增加配置目录，例如 `backend_server/config/hints/<problemId>.json`，格式与你 OpenCoach 方案一致（如 `problem_id`, `pitfalls[]`, `trigger_condition`, `teacher_hint`）。
- **方案 B**：在 MySQL 增加表（如 `oj_problem_hints`），存题目维度的「坑点 + 引导策略」。
- 无论 A/B，都需提供**按题目拉取**的接口（如 `GET /api/coach/hints/:problemId`），供教练服务或前端组 system prompt 时使用。

### 2. 教练 API（错误分层 + CE 翻译官 + 锦囊注入）

- **位置二选一**：  
  - **Al_server（Python）**：新增 `POST /api/coach/guide`（或 `/api/coach/stream-guide`），接收 `problem_id`、`code`、`verdict`、`error_message`、可选 `chat_history`；内部根据 verdict 选模式（CE → 翻译官，RE → 侦探，WA → 推演，TLE → 脚手架），再查名师锦囊与报错知识库，拼 system prompt，调 DashScope 流式返回。  
  - **backend_server（Node）**：同理新增路由，直接调 DashScope（或调 Al_server 的现有/新 HTTP 接口），由 Node 做错误分层与锦囊注入。
- **输入**：必须包含 `verdict` 和 `error_message`（及 code、problem_id），这样才不再是「静态数据」，而是真实评测结果驱动的引导。
- **输出**：流式文本即可；若需「第一步/第二步」结构化，可在 prompt 里约束 AI 输出步骤标记，前端解析展示。

### 3. 前端（Vue）新增「AI 助教」面板

- 在 **OJ 题目页**（做题/提交结果页）增加一块可折叠或固定区域：「AI 助教」。
- 交互要点：  
  - 用户提交后，若 `verdict !== 'Accepted'`，展示本次的 verdict 与 error_message（或首条失败测例 error），并出现「请求 AI 助教引导」按钮。  
  - 点击后带当前 code、verdict、error_message、problem_id（及可选 chat_history）请求教练 API，以流式方式展示回复。  
  - 保留「有启发 / 没听懂，求助人类老师」类反馈；「求助人类老师」时请求后端工单接口（见下），不再只在前端弹文案。
- UI/交互可参考 OpenCoach 的聊天区与反馈按钮，用 Vue 3 + 现有请求方式实现即可，无需引入 React。

### 4. 求助教练工单与闭环

- 后端新增，例如 `POST /api/coach/ticket`，body：`problem_id`、`submission_id`、`code`、`error_message`、`last_ai_reply`、`student_question`（可选）。  
- 后端将工单写入 MySQL（新表如 `coach_tickets`）或转发到飞书/钉钉 webhook；老师回复后，可写回同一张表或单独表，便于后续做「老师回复 → 报错知识库/RAG」的闭环。  
- 前端在「没听懂，求助人类老师」时调用该接口，并提示「工单已提交」。

### 5. 报错知识库（RAG 雏形）

- 与 OpenCoach 迭代计划一致：将「常见报错 → 教师经验/建议问法」做成可配置（如 JSON 或 DB），在拼教练 system prompt 时根据 `error_message` 做关键词/模糊匹配，命中则注入对应话术；未命中则用通用启发式（CE 用行号引导，RE 用边界/递归检查等）。

---

## 五、数据流小结（融合后）

1. 学生在 gespgrowplan 选 OJ 题 → 写代码 → 提交。  
2. 后端用现有 isolate 判题，写入 `oj_submissions`（verdict、error_message、results）。  
3. 前端拿到非 AC 结果后，在助教面板展示 verdict/error_message，用户点「请求引导」。  
4. 前端请求教练 API，传入 problem_id、code、verdict、error_message；后端或 Al_server 按 verdict 选模式，拉取该题名师锦囊与报错知识库，调 LLM 流式返回。  
5. 用户可选择「有启发」或「求助人类老师」；后者调工单接口，形成闭环并沉淀数据。

这样，**题目与评测全部来自 gespgrowplan，不再使用静态数据**；**教练逻辑与交互来自 OpenCoach 设计**，以接口和 Vue 组件形式融入，无需把两套前端合成一个技术栈。

---

## 六、实施顺序建议

1. **在 gespgrowplan 后端**确认提交详情接口返回 `verdict`、`error_message`（及必要时的 results 首条 error），前端能直接拿到。  
2. **名师锦囊**：先做配置文件或简单表 + `GET /api/coach/hints/:problemId`，便于后续教练 API 注入。  
3. **教练 API**：在 Al_server 或 Node 实现 `POST /api/coach/guide`（含错误分层与流式），用真实 verdict/error_message 驱动。  
4. **Vue 助教面板**：在 OJ 题目页加聊天区 + 「请求引导」+ 反馈/工单按钮，对接上述接口。  
5. **工单接口与闭环**：`POST /api/coach/ticket` + 存储/通知，前端「求助人类老师」调用。  
6. **报错知识库**：可配置化 + 在教练 prompt 中做匹配与注入，与现有迭代计划一致。

若你希望，我可以下一步把「教练 API 的请求/响应格式」或「Vue 助教面板的接口调用示例」写成更细的接口说明（仍不写具体代码，只定契约）。

---

## 七、方案 B：OpenCoach 整页作为 gespgrowplan 的一个新页面（iframe 嵌入）

**思路**：不重写 OpenCoach 的 React 页面，而是把 **OpenCoach 的整个单页** 当作 gespgrowplan 里的一个**新路由/新页面**，用 **iframe** 嵌入；OpenCoach 通过 URL 参数和 gespgrowplan 的 API 拿题目、交代码、拿评测结果，从而「长在」gespgrowplan 里。

### 7.1 在 gespgrowplan 侧要做的事

1. **新增一个路由（新页面）**  
   - 例如：`/oj/:problemId/coach` 或 `/coach?problemId=123`（可选 `taskId`、`submissionId` 等）。  
   - 该路由对应的 Vue 页面**只渲染一个全屏 iframe**，`src` 指向 OpenCoach 的访问地址，并把当前题目 ID（及需要时任务 ID）通过 query 传给 OpenCoach，例如：  
     `https://你的OpenCoach域名/?problemId=123&apiBase=https://gespgrowplan-api域名&taskId=456`

2. **入口从哪里进**  
   - 在 OJ 题目页（或题目列表）加一个按钮/链接：「用 AI 助教做题」或「打开 OpenCoach」，点击后跳转到上述新页面（或新开标签页），即打开带 `problemId` 的 OpenCoach 页面。

3. **iframe 的 src 怎么定**  
   - **同域部署**：OpenCoach 和 gespgrowplan 前端部署在同一域名下（例如 gespgrowplan 在 `https://xxx.com`，OpenCoach 在 `https://xxx.com/opencoach/`），则 iframe `src="/opencoach/?problemId=123"`，OpenCoach 内部再通过 env 或同域请求拿到 gespgrowplan 的 API 地址。  
   - **异域部署**：OpenCoach 单独一个域名，则 iframe `src="https://opencoach.xxx.com/?problemId=123&apiBase=https://api.xxx.com"`，需要 gespgrowplan 后端配置 CORS 允许 OpenCoach 的域名请求 API（或通过 gespgrowplan 后端做一层代理转发到 OpenCoach 再转发到 API，避免浏览器跨域）。

### 7.2 在 OpenCoach 侧要做的事（最小改动）

1. **从 URL 读参数**  
   - 页面加载时解析 `problemId`（必选）、可选 `taskId`、`submissionId`、`apiBase`（gespgrowplan 后端 API 根路径，若同域可写死在 env）。

2. **题目数据来源改为 gespgrowplan API**  
   - 不再使用本地 `MOCK_PROBLEM`。  
   - 调用 `GET /api/oj/problems/:problemId`（或 gespgrowplan 实际题目详情接口），拿到 title、description、input_format、output_format、data_range、samples 等，映射成 OpenCoach 当前使用的题目结构，用于左侧「题目描述」和 system prompt 中的「当前题目环境」。

3. **提交评测改为 gespgrowplan API**  
   - 不再使用前端的 `mockSubmitCode()`。  
   - 用户点「提交评测」时，调用 gespgrowplan 的提交接口（例如 `POST /api/oj/submit`，body：problem_id、code、language、可选 task_id 等），拿到返回的 `verdict`、`error_message`、`results`。  
   - 用**真实**的 verdict 和 error_message 驱动后续逻辑：展示评测结果、触发 CE/RE/WA 的引导（调用现有 `callLLMAPI` 时传入真实 errorLog 和对应 mode）。

4. **名师锦囊**  
   - 若 gespgrowplan 提供 `GET /api/coach/hints/:problemId`，OpenCoach 在加载题目后请求该接口，把返回内容注入 system prompt，替代或补充本地 `TEACHER_KNOWLEDGE_BASE`；若暂无该接口，可暂时仍用 OpenCoach 本地配置或静态 JSON。

5. **认证（可选）**  
   - 若 gespgrowplan 的提交接口需要登录态，iframe 内 OpenCoach 发请求时需要带上 cookie（同域时自动带）或 token（可通过 URL 参数由 gespgrowplan 传入，或通过 postMessage 由父页传入）。

### 7.3 数据流（方案 B）

```
用户点击「用 AI 助教做题」
  → 进入 gespgrowplan 路由 /oj/123/coach
  → 页面只渲染 iframe，src = OpenCoach 地址 + ?problemId=123（及 apiBase 等）
  → OpenCoach 页内：GET /api/oj/problems/123 拉题目 → 渲染左侧题目 + 编辑器
  → 用户写代码、点「提交评测」
  → OpenCoach：POST /api/oj/submit → gespgrowplan 后端 isolate 判题
  → 返回 verdict + error_message
  → OpenCoach 用真实结果展示 CE/WA/RE 等，并调用现有 AI 引导（callLLMAPI）
```

这样，**OpenCoach 仍然是单独一个 React 单页**，只是数据源和提交从「本地 mock」换成「gespgrowplan 的 API」；**gespgrowplan 只多了一个新页面（一个 iframe）**，无需用 Vue 重写教练 UI。

### 7.4 同域部署示例（推荐）

- 部署时把 OpenCoach 构建产物放到 gespgrowplan 静态资源目录下，例如 `frontend/dist/opencoach/`，访问路径为 `https://同一域名/opencoach/`。
- gespgrowplan 路由：`/oj/:problemId/coach` → 渲染 iframe，`src="/opencoach/?problemId=" + problemId`。
- OpenCoach 的 `.env` 或构建时注入：`VITE_GESP_API_BASE=https://同一域名/api`，请求题目和提交都用该 base，同域 cookie 可带登录态。

### 7.5 小结

| 项目 | 方案 A（Vue 助教面板） | 方案 B（OpenCoach 整页 iframe） |
|------|------------------------|----------------------------------|
| gespgrowplan 改动 | 新 Vue 组件 + 教练 API 调用 | 新路由 + 一个 iframe + 后端 CORS/同域 |
| OpenCoach 改动 | 无（仅作参考） | URL 参数 + 题目/提交改用 gespgrowplan API |
| 技术栈 | 全部 Vue | 保留 React 单页，嵌入 iframe |
| 适用 | 希望统一在一个 Vue 应用内 | 希望尽快复用现有 OpenCoach 页面、少写 Vue |

**结论**：可以先把 OpenCoach 的单个页面作为 gespgrowplan 的**新页面**用 iframe 融入，再按需在 OpenCoach 内接好题目接口和提交接口即可。
