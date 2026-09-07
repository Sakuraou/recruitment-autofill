# 校招智能网申助手 · 2027

从本地个人档案识别并填写招聘网页中的重复信息。MVP 1 使用规则、中文别名和 DOM 上下文匹配普通原生表单，展示匹配依据与置信度；模糊内容需要人工检查。当前版本不接入 LLM，没有 API Key、云端账户或后端数据库。

本项目采用 AI 协作开发：项目发起者提出校招网申场景、产品需求和验收约束，Codex 协助完成代码实现与自动化验证。仓库中的档案样例全部为虚构测试资料。

**v0.1.1 已完成本地验收（2026-09-07）：162 项自动化测试、lint、TypeScript strict 和生产构建全部通过；实际 MV3 安装包在 Chromium 153 中完成原生表单与移动结构模拟页面的端到端测试。** 已根据中国移动公开页面模板修复提示语误判和普通下拉框识别；用户登录后的实际页面仍待复测。详细结果见 [验收记录](VERIFICATION.md)。

## 开发与构建

需要 Node.js **22.12.0 或更新版本**及 npm。在项目目录运行：

```powershell
npm ci
npm run check
```

`check` 依次执行 lint、TypeScript strict 类型检查、测试和构建。单独构建使用：

```powershell
npm run build
```

扩展安装目录是生成的 `dist/`。`npm run dev` 仅提供 Vite 开发页面，不能代替加载扩展后的权限、消息与 Content Script 验证。

需要复现浏览器端到端测试时：

```powershell
npx playwright install chromium
npm run test:e2e
```

该脚本启动临时隔离的测试浏览器和本机测试页，使用虚构资料，结束后关闭测试浏览器；不会连接日常浏览器或访问真实招聘网站。它需要 4173 端口空闲。Playwright 仅作为开发测试依赖，不进入扩展安装包，也不用于自动投递。

## 安装到 Chrome / Microsoft Edge

可从 [GitHub Releases](https://github.com/Sakuraou/recruitment-autofill/releases) 下载已构建的安装包，完整解压后加载其中包含 `manifest.json` 的文件夹。源码安装按以下步骤进行。

1. 完成构建。
2. Chrome 打开 `chrome://extensions`；Edge 打开 `edge://extensions`。
3. 打开「开发者模式」，选择「加载已解压的扩展程序」。
4. 选择本项目的 **`dist` 文件夹**，然后将扩展固定到工具栏。
5. 点击扩展，打开档案管理页，填写自己的真实资料并保存。也可以先使用下方的虚构测试档案验收。

更新代码后重新构建，在扩展管理页点击刷新。若正在测试的网页还保留旧 Content Script，也请刷新该网页再扫描。浏览器内部页面（如扩展管理页）、应用商店及其他受限页面不能作为填表目标。

## 本地试用：导入 → 保存 → 扫描 → 填写

在项目目录启动测试页：

```powershell
npm run serve:example
```

打开 [本地测试表单](http://127.0.0.1:4173/test-form.html)。服务器只绑定 `127.0.0.1:4173`，只读取 `examples/` 中允许的静态文件，不接收表单上传。按 `Ctrl+C` 停止；端口占用时请先关闭占用该端口的进程。

1. 从测试页下载 [sample-profile.json](examples/sample-profile.json)。姓名为「测试同学」，手机号为不可用的 `00000000000`，邮箱使用 `example.invalid`；学校、项目、论文与家庭成员全部为虚构测试数据。
2. 在扩展档案管理页选择 JSON 导入，检查内容，**保存档案**。样例不会自动写入扩展，也不能用于真实投递。
3. 切回测试页，点击扩展的扫描按钮。
4. 检查每个字段的来源、档案路径、置信度和处理说明，再执行高置信度填写；待确认的候选应先核对。
5. 检查本科与硕士对应关系、学历与学位、已有值、验证码与未知问题。页面顶部提交计数应保持 **0**。
6. 点击「新增“民族”字段」后重新扫描。扫描后手工修改姓名，再执行旧扫描结果，验证已有值受到保护。
7. 如需验证测试页本身的拦截机制，可人工点击「人工测试提交拦截」；计数会增加，但不会发送表单。点击「重置测试表单」可恢复初始状态。

测试档案故意将硕士放在教育数组第一项、本科放在第二项，并省略 GPA 与专业类别。缺失信息应保持空白；「软件工程」不能直接被当作「计算机类」的已知事实。

## 日常使用

在真实招聘页面填写前，先维护完整、准确的档案，并检查教育层次、学位、日期与经历归属。打开目标页面后主动扫描，再查看匹配结果并填写。没有可靠档案信息的字段需要手工填写。

已填写、只读或禁用的控件应保留。动态新增经历、页面跳转、切换步骤、更换档案或改变选择项后，需要重新扫描。第一次使用某个招聘网站时，请逐项核对；目前只针对移动校招公开模板增加了适配和模拟验证，未逐站验证登录后的实际页面。

MVP 1 的可靠支持范围是**顶层页面中的原生 `input`、`textarea`、单选 `select`**。radio、checkbox、上传附件、验证码、短信验证、身份认证与最终提交由用户人工处理。iframe、shadow DOM、自定义 Select、Ant Design / Element Plus 等组件及联动地址选择器不属于本版完整兼容范围。后续只针对实际遇到的问题增加适配器。

**中国移动校招页面（v0.1.1）：** 在 `job.10086.cn/personal/resume_campus.html` 增加站点适配：识别网站写在 `value` 中的已知提示语、`dt` 字段标题、经历区域和普通 `.slt` 下拉选项。选择下拉选项时使用网站自身的选项事件，让页面内部选项代码同步更新。证件类型会联动生日和性别，因此保留人工选择；日期、城市和学校目录也需人工操作。先手动打开目标区域的编辑表单再扫描。操作说明见 [移动页面修复与 Edge 使用](MOBILE_FIX.md)。

置信度 ≥90% 的规则结果可通过按钮批量填写；低于 90% 的候选先勾选「我已核对这个候选」，再点击确认填写。无候选、多段经历无法对应或已超字数限制时，保留人工填写。多段项目和实习可在档案中管理，但本版不会按网页排列顺序猜测对应关系。

Debug 展示 DOM 描述、档案路径、来源与置信度，复制时隐藏候选值和已知个人资料。岗位 JD 可手动粘贴或读取页面选中文本，仅作为当前弹窗备忘，关闭后清除；本版不使用它生成答案。

## 数据与权限边界

- `activeTab`：用户主动操作扩展时，临时访问当前标签页。扩展没有申请常驻所有网站访问权限。
- `scripting`：在用户选择扫描的页面注入 Content Script，用于读取和填写表单。
- `storage`：把档案与相关设置保存到当前浏览器配置中的 `chrome.storage.local`。
- `chrome.storage.local` **不是加密保险箱**。扩展未实现 Web Crypto 加密，设备或浏览器配置被他人访问时不能据此保证保密；卸载扩展也可能移除本地数据。
- JSON 导出备份包含档案原文，可能包括身份证、手机号、住址与家庭成员。请放在自己控制的位置，分享调试资料前检查并遮盖敏感信息。
- MVP 1 不调用 LLM，不把档案上传到开发者服务器；测试服务器也不接收个人资料。档案一旦被填入招聘网页，该网站就能读取这些值，并按自己的逻辑处理。
- 扩展不会主动点击投递／提交按钮，不调用表单提交，也不触发 Enter 操作。填写时为兼容网页会触发 `input` / `change`；**网站自己的事件处理可能保存数据或触发其他行为**。请留意网站提示。

## 第一版结构

```text
recruitment-autofill/
├── manifest.json              # Manifest V3 与最小权限
├── src/
│   ├── background/            # Service Worker
│   ├── content/               # DOM 扫描、字段执行与页面消息
│   ├── matching/              # 规则、中文别名与候选选项匹配
│   ├── profile/               # 档案 Schema 与本地存储
│   ├── popup/                 # 扫描、匹配预览、填写和调试
│   ├── options/               # 档案管理、JSON 导入导出
│   └── shared/                # 字段、匹配与消息类型
├── examples/                  # 原生中文测试表单、虚构样例档案
├── scripts/                   # 构建与仅本机测试服务器
├── tests/                     # 自动化测试
└── dist/                      # 构建后加载此目录
```

架构流程：用户在 Popup 发起操作 → Content Script 扫描页面并返回字段描述 → 规则匹配本地 Profile → 展示依据和置信度 → 经过执行检查后回填页面。低置信度、歧义和缺失事实不应被当作可靠自动填写结果。

完整 TypeScript 档案类型与运行时校验见 [src/profile/schema.ts](src/profile/schema.ts)，`FieldDescriptor`、`MatchResult` 和消息结构见 [src/shared/types.ts](src/shared/types.ts)。Profile 使用 `schemaVersion: 1`，结构包括：

| 部分 | 内容 |
| --- | --- |
| `basic` | 姓名、联系方式、出生日期、籍贯、生源地等 |
| `education[]` | 学校、专业、专业类别、`level` 学历、`degree` 学位、日期、成绩、研究方向、课程 |
| `research` | 研究方向、摘要、论文、专利 |
| `projects[]`、`internships[]`、`studentWork[]` | 多段项目、实习、学生工作 |
| `awards[]`、`certificates[]` | 奖项、证书 |
| `skills` | 编程语言、框架、工具和其他技能 |
| `commonAnswers` | 自我评价、个人优势、规划、动机、岗位匹配与研究／项目简介 |
| `family[]` | 家庭成员资料 |

`TextVariants` 支持 `short`、`medium`、`long` 和 `byLimit`，例如 `byLimit["50"]`、`byLimit["100"]`、`byLimit["200"]`、`byLimit["500"]`。这些是你自己保存的版本，MVP 1 不生成或扩写事实。缺少答案时请补充真实档案，不能通过编造测试数据解决。

## 验收清单与后续开发

本地夹具首次扫描 43 个字段：28 个高置信度、1 个待确认、2 个缺少资料、10 个需人工处理、2 个保留已有值。实际填写成功 28 项，专业类别只在显式确认后写入，提交事件计数为 0。动态添加民族字段后重扫成功填写；Content Script 读取完整档案被浏览器拒绝。另有 React 受控 input、textarea、select 状态更新测试。自动化检查不等同于具体招聘网站的真实兼容性验证。

后续按照实际使用反馈推进：先完善 Generic 表单适配，再考虑结构化输出并校验的 LLM 字段匹配，最后加入需预览确认的开放题生成。不会因为引入 AI 而绕过事实约束、敏感数据保护或人工提交。

实现依据：[Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)、[Chrome Storage](https://developer.chrome.com/docs/extensions/reference/api/storage)、[Playwright 扩展测试](https://playwright.dev/docs/chrome-extensions)。
