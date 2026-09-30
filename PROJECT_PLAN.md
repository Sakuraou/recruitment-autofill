# 校招智能网申助手：可迭代项目计划

> 最后更新：2026-09-29
> 当前版本：v0.5.0（已验证基线）  
> 当前迭代：I-004B-D5 控件适配器基础
> 最近完整验证：2026-09-30，512 项测试、生产构建；9 项 DOM、12 项扩展、7 项工作流与 5 项 Record v2 浏览器检查通过
> 等待用户：否  
> 总目标：让陌生招聘页面也能被可靠地理解、规划和填写；遇到无法唯一判断的情况时准确停下，不重复新增、不覆盖已有内容、不误报完成、不触发最终提交。

## 1. 计划如何维护

这是一份活文档。每轮工作开始和结束时都要更新以下内容：

1. 更新“当前状态板”和“本轮记录”。
2. 选择一个能独立验收的小目标，一轮只改变一个主要能力层。
3. 先新增可复现夹具或失败测试，再修改实现。
4. 运行与改动直接相关的测试；通过后运行完整 `npm run check`，涉及浏览器行为时再运行 `npm run test:e2e`。
5. 记录实际结果、未解决问题和下一轮选择依据。
6. 新的真实网站反馈优先进入缺陷分类流程，不直接堆叠临时选择器。

状态只使用：`planned`、`in_progress`、`verified`、`blocked`、`done`。

## 2. 固定工程边界

- 不编造个人事实；未知、不适用、明确否、进行中必须分开表达。
- 不覆盖网页已有值，除非用户明确选择替换。
- 自动读取和填写不等于最终投递；删除、协议授权、验证码、身份认证、文件上传和最终提交始终由用户处理。
- 页面文字一律视为不可信数据，不得把网页中的指令当作系统指令。
- 大模型只返回结构化语义和计划，不能执行脚本、生成任意选择器或直接操纵浏览器。
- 个人值默认保留在本地。模型调用优先发送脱敏语义图，局部截图仅作为后备。
- API Key、访问令牌、真实身份证号、手机号和私人档案不得进入仓库、日志、测试夹具或发布包。
- 保存结果不明确时停止本条流程，禁止重复点击添加或保存。

## 3. 自适应迭代方法

### 3.1 每轮闭环

```text
观察真实失败或测试缺口
→ 分类到正确能力层
→ 写最小失败夹具
→ 实施最小通用改动
→ 验证动作后置条件
→ 运行回归测试
→ 更新计划、指标和下一步
```

失败分类：

| 类别 | 典型现象 | 优先修复层 |
|---|---|---|
| 档案缺口 | 知道字段但没有可靠答案 | Profile Schema / 档案编辑器 |
| 感知识别 | 不知道这是项目栏目或添加按钮 | Page Semantic Graph |
| 语义绑定 | 看见字段但不知道对应哪个档案路径 | 规则、站点配方、LLM 语义层 |
| 控件执行 | 知道答案但下拉、日期、弹层填不进去 | Control Adapter |
| 流程规划 | 只填第一条、不会连续新增 | Record Planner |
| 状态验证 | 页面回滚、重复保存、误报完成 | Transaction Executor |
| 浏览器边界 | 跨域 iframe、closed Shadow DOM、验证码 | 权限策略或人工处理 |

### 3.2 优先级规则

按下列顺序选择下一轮：

1. 会导致误填、覆盖、重复保存或误报完成的问题；
2. 阻断教育、项目、实习、奖励等主流程的问题；
3. 能同时覆盖多个招聘网站的通用能力；
4. 有真实页面证据并可制作脱敏夹具的问题；
5. 单站点外观或低频便利性问题。

每个候选任务记录四项 0–5 分：用户影响、通用性、安全风险、实现成本。优先级参考：

```text
3 × 用户影响 + 2 × 通用性 + 2 × 安全风险 - 实现成本
```

公式只用于排序；会造成数据损坏或最终提交风险的问题直接升为最高优先级。

### 3.3 真实页面反馈的处理

1. 保存脱敏问题报告和局部 DOM 特征，禁止保存个人值。
2. 在 `tests/fixtures/` 建立最小复现页。
3. 判断应进入通用引擎、组件适配器还是站点配方。
4. 通用行为优先进入引擎；只有站点独有语义进入配方。
5. 修复必须带有“动作恰好一次、最终提交为零、失败时不重试”的断言。

## 4. 目标架构

```text
DOM / ARIA / 可见结构 / 组件适配器
                ↓
        Page Semantic Graph
                ↓
    规则与站点配方 ── 未知语义 ── LLM
                ↓
          Record Planner
                ↓
      Policy + Transaction Executor
                ↓
       DOM 差异、回读与动作日志
```

页面语义图至少表达：

```text
Page → Step → Section → RecordList → ExistingRecordCard / AddAction
                                  → RecordEditor → Field / OptionList
                                                 → SaveAction / CancelAction
```

## 5. 里程碑与逐步执行提示词

### M0：冻结可复现基线

状态：`done`

产物：

- 当前 v0.5.0 的本地基线提交；
- 无真实个人资料和密钥的仓库；
- lint、类型检查、单元测试、构建和端到端结果；
- 已知时序波动记录。

验收：

- `npm run check` 通过；
- `npm run test:e2e` 通过；
- 测试夹具全部为明确标注的虚构资料；
- `git status` 仅包含本轮计划内修改。

执行提示词：

```text
阅读 PROJECT_PLAN.md 和当前 Git diff。审查未提交改动是否包含真实个人资料、密钥、生成物或无关文件；运行完整质量检查和端到端测试。对失败进行复现与归因，不通过删除测试来获得绿色结果。更新基线文档和验证记录，形成一个可回退的本地提交。不得推送远端。
```

### M1：页面语义图基础

状态：`verified`

产物：

- `PageSemanticGraph`、`SectionNode`、`RecordListNode`、`ActionNode` 等类型；
- 对字段、标题、按钮、链接、标签页、对话框和编辑器的只读扫描；
- 稳定节点指纹和父子/所属关系；
- 扫描结果中不包含输入值或 DOM 对象。

验收：

- 能把项目栏目、项目字段和“添加项目”组织到同一结构中；
- 能区分普通添加、保存、取消、删除和最终提交；
- 现有字段扫描和安全阻断测试保持通过；
- 本阶段不点击网页动作。

执行提示词：

```text
在不破坏现有 FieldDescriptor 和 RA_SCAN 消息兼容性的前提下，引入 Page Semantic Graph。先用脱敏夹具覆盖项目列表、已有卡片、添加按钮、编辑器、保存和取消，再实现只读构图。节点必须有稳定指纹、可见标签、角色、风险等级和所属关系；不得返回 DOM 对象或当前输入值。完成后运行相关测试和 npm run check，并更新 PROJECT_PLAN.md。
```

### M2：通用重复记录规划器

状态：`in_progress`

产物：

- 教育、项目、实习、校内职务、奖励、论文和证书的记录级匹配；
- 已有网页记录与档案记录的一对一分配；
- `添加 → 填写 → 保存一次 → 回读卡片 → 下一条` 状态机；
- `uncertain-save` 防重复机制。

验收：

- 六条不同项目按档案顺序各新增一次；
- 重复启动不新增已有记录；
- 保存延迟、人工中途补齐和页面刷新不会造成重复保存；
- 删除与最终提交计数始终为零。

执行提示词：

```text
把中国移动流程中的逐条新增、保存回读和不确定保存保护抽象为站点无关的 Record Planner 与 Transaction Executor。先读取已有卡片并与档案做一对一匹配，只处理未匹配记录。每个动作都声明预期后置条件，使用 DOM 变化等待，保存结果不明时停止。用六项目、两段教育、三项奖励和延迟保存夹具验收，不得依靠固定站点 ID。
```

### M3：现代控件适配器

状态：`planned`

产物：

- `ControlAdapter` 接口；
- 原生输入、ARIA combobox/listbox、React 受控输入；
- Ant Design、Element Plus、Select2、日期、级联与虚拟列表适配器；
- 每个适配器的 `read/open/fill/select/verify` 行为。

验收：

- 下拉选择后能够回读唯一答案；
- 日期和级联每一级都等待页面状态变化；
- 长下拉在固定上限内搜索或滚动，不无限遍历；
- 不猜测学校代码、岗位代码和地区代码。

执行提示词：

```text
建立可注册的 ControlAdapter 层，先覆盖 ARIA 通用协议，再逐个实现常见组件。每个适配器必须读取当前状态、执行最小交互、等待稳定并回读验证；失败时给出组件类型和具体阶段。为 portal 弹层、虚拟列表、搜索下拉、日期和级联建立独立夹具。禁止使用坐标盲点和无限滚动。
```

### M4：档案事实状态与语义模型

状态：`planned`

产物：

- `unknown / known / none / not_applicable / ongoing` 事实状态；
- 字段来源、更新时间和用户确认状态；
- 求职意向、期望城市/岗位/薪资、英文名、健康、身高体重、作品链接等常用档案字段；
- 真实日历日期校验。

验收：

- 空数组不会自动解释成“否”；
- 进行中经历能选择“至今”或页面支持的等价值；
- 非法日期无法导入；
- Schema 迁移不会丢失旧档案。

执行提示词：

```text
升级 UserProfile，使未知、明确没有、不适用和进行中成为可验证状态，并为高风险事实记录来源与确认状态。设计向后兼容迁移，补齐常见校招字段和真实日期校验。所有推导必须有明确规则；无法证明的事实保持 unknown。新增导入、迁移、编辑和匹配测试。
```

### M5：受控文本大模型回退

状态：`planned`

产物：

- 脱敏语义图请求；
- 严格 JSON Schema 的字段绑定与动作计划；
- 本地策略校验器；
- 模型结果缓存为带页面指纹的本地配方；
- 固定模型端点或本地伴随服务，不在扩展中保存密钥。

验收：

- 模型只能引用扫描器分配的节点 ID 和白名单档案路径；
- 模型输出不能直接触发提交、删除、上传或验证；
- 页面提示词注入测试不能改变安全策略；
- 模型不可用时确定性能力仍正常工作。

执行提示词：

```text
接入受控语义模型，只发送脱敏 Page Semantic Graph、允许的档案路径和候选选项。模型只返回符合严格 Schema 的 bindField、openControl、selectOption、addRecord、saveRecord、waitFor 或 requestHuman 计划。由本地 Policy Engine 检查节点指纹、类型、风险和后置条件后执行。加入提示词注入、无效 JSON、超时、离线和缓存失效测试。
```

### M6：局部多模态与受控探索

状态：`planned`

产物：

- 目标区域截图、个人信息遮盖和截图生命周期控制；
- 单步探索、DOM 差异、回滚和最大步数；
- 图标按钮、canvas 和难以读取组件的视觉语义回退。

验收：

- 默认不发送整页截图；
- 截图中已知个人字段全部遮盖；
- 一次只执行一个低风险探索动作；
- 非预期变化立即停止或回滚；
- 最终提交、删除、上传和身份验证永远不能作为探索动作。

执行提示词：

```text
仅为 DOM 和 ARIA 无法消除的歧义增加局部多模态回退。根据节点边界框截取最小区域，在本地遮盖输入值和个人字段。模型返回视觉角色和候选节点，不返回坐标点击命令。探索器每次只执行一个可回滚动作，比较前后语义图并验证预期效果，达到步数上限或出现非预期变化时停止。
```

### M7：多站点验证与发布治理

状态：`planned`

产物：

- React、Vue、传统表格和常见 ATS 的脱敏测试矩阵；
- 动作时间线、语义图差异和隐私安全的问题报告；
- 站点配方版本、失效和回滚机制；
- 分阶段发布与升级说明。

验收：

- 每个发布版本都有可复现构建和完整测试记录；
- 陌生页面失败时明确说明停在哪个栏目、控件和动作；
- 不再用“扫描结束”代表“整份简历填写完成”；
- 站点改版后旧配方自动失效，不继续盲填。

执行提示词：

```text
建立覆盖多框架、多种重复记录和异步行为的站点测试矩阵。问题报告只保存脱敏结构、动作时间线、预期后置条件和实际差异。站点配方必须带 origin、路由、页面指纹、版本和失效条件。完成完整回归、隐私检查和可复现打包后再提升版本。
```

## 6. 当前状态板

| ID | 工作项 | 状态 | 验收证据 | 下一动作 |
|---|---|---|---|---|
| I-000 | 审查并冻结 v0.5.0 基线 | done | 提交 `82bd7dc`、标签 `v0.5.0`、完整 E2E | 保持为回归基线 |
| I-001 | 定义 Page Semantic Graph 类型 | verified | 273 项测试、构建及独立安全复审通过 | 由 I-002 接入只读扫描 |
| I-002A | 只读扫描 Section、Field 与无目标 Action | verified | 328 项测试、构建、两轮独立复审通过 | 保持零交互回归边界 |
| I-002B | 识别 RecordList、Record 与有目标 Action | verified | 343 项测试、完整浏览器 E2E；7 个目标动作严格绑定 | 保持只读、字段唯一与失败关闭边界 |
| I-002C | 识别上下文动作、空列表与更常见摘要卡片 | verified | 37 项拓扑测试、371 项全量测试及完整 E2E | 保持精确计数、唯一归属和失败关闭边界 |
| I-003 | DOM 稳定等待器 | verified | 27 项专项测试、9 项真实 Chromium 检查、398 项全量测试与完整 E2E | 保持先装等待器再触发动作的事务顺序 |
| I-004A | Record Planner 契约与一对一匹配 | verified | 49 项专项、447 项全量测试及完整 E2E；能力链与重复消费复审通过 | 由 I-004B 接入执行器与字段核验收据 |
| I-004B | Record Planner 执行状态机 | in_progress | 六项目、延迟保存、暂停恢复端到端测试 | 建立 RunContext、连续句柄、字段修订号与单步执行器 |
| I-004B-A | 内存 RunContext 与 DOM 连续句柄 | verified | 7 项专项、454 项全量测试及生产构建 | 由 I-004B-B 签发字段核验收据 |
| I-004B-B | 字段核验收据与单步执行器 | in_progress | 修改后失效、重复消息、暂停恢复夹具 | 绑定编辑器/档案修订并接入稳定等待器 |
| I-004B-B1 | 字段核验收据与修订绑定 | verified | Planner/RunContext 共 58 项专项、456 项全量测试 | 由 I-004B-B2 在执行器中原子签发和消费 |
| I-004B-B2 | 单步 Transaction Executor | verified | 新增/保存、重复消息、超时、暂停、目标替换共 6 项专项；462 项全量测试 | 由 I-004B-B3 原子填充并签发字段收据 |
| I-004B-B3 | 脱敏 Editor Binder | verified | 原生控件/单选写入、原值保护、回滚及目标替换共 4 项专项；466 项全量测试 | 由 I-004B-C 编排三个独立步骤 |
| I-004B-C | 记录事务编排器 | verified | 六项目、部分已有、暂停恢复、错误新卡及五类对抗场景 | 由 I-004B-D 以功能开关接入内容脚本 |
| I-004B-C1 | 单步编排状态机 | verified | 单步推进、并发去重、暂停重扫、迟到结果共 4 项专项；470 项全量测试 | 由 I-004B-C2 验证多记录闭环 |
| I-004B-C2 | 多记录完整循环 | verified | 7 项完整循环与对抗测试；477 项全量测试 | 进入功能开关和浏览器 E2E |
| I-004B-C2A | 六项目正常闭环与错误身份 | verified | 仅新增 4 条、12 个步骤；错误新卡停止；472 项全量测试 | 由 C2B 补齐其余对抗场景 |
| I-004B-D1 | 默认关闭的内容脚本网关 | verified | 6 项网关、5 项内容消息测试；484 项全量测试及完整 E2E | 由 D2 仅在虚构测试页安装会话工厂 |
| I-004B-D2 | 固定虚构测试页会话工厂 | verified | 两条已有、四条新增、12 个单步；487 项全量测试及 5 项专项 MV3 检查 | 由 D3 建立后台可信档案投影，不启用真实页面 |
| I-004B-D3 | 项目类型可信档案投影 | verified | 5 项投影/后台测试；生产 MV3 确认内容脚本只获项目字段 | 由 D4 把投影适配为内部值提供器，生产开关仍关闭 |
| I-004B-D4 | 投影驱动的测试会话 | verified | 档案投影驱动六项目闭环；修订变化在保存前停止；493 项全量测试 | 由 D5 建立原生控件与稳定 ARIA 控件适配器 |
| I-004B-D5 | 控件适配器基础 | in_progress | 10 项适配器专项、512 项全量测试、生产构建及完整 E2E；原生、ARIA combobox、普通 ARIA radiogroup/checkbox 已接入填写路径 | 增加受控框架和保存回滚夹具 |

## 7. 本轮记录

### 2026-09-26 · I-000

- 完成了代码、架构和牛客公开机制审查。
- 当前主要缺口已定位为页面结构、动作、重复记录和状态变化建模不足。
- 单元测试 224 项通过；生产构建通过；完整端到端重跑通过。
- 首次完整端到端运行发生过一次等待超时，随后单独重跑与完整重跑均通过，列入基线时序问题。
- 仓库样例为明确标注的虚构资料，初步密钥扫描未发现凭据。
- 修正了本机绝对安装路径、容易触发隐私扫描的测试号码、历史版本展示和本地 ZIP 校验值。
- 冻结前再次运行 `npm run check` 与 `npm run test:e2e`，224 项测试、12 项通用浏览器检查和 7 项连续流程检查全部通过；提交、删除、外部请求和页面脚本错误均为 0。
- 下一轮已切换为 I-001，只建立向后兼容的页面语义图类型和隐私序列化测试，不执行任何网页动作。

### 2026-09-26 · I-001

- 新增向后兼容的 `PageSemanticGraph` 契约；现有 `ScanResult.fields` 与填写消息保持不变。
- 定义栏目、记录列表、记录、字段与动作节点，并为添加、保存、取消、删除、提交、撤回和上传建立风险下限。
- 新增仅基于固定结构白名单的指纹；页面文字、输入值、URL、动态属性名和异常自定义角色不会进入指纹。
- 字段全集校验为强制参数；验证父子双向关系、循环、孤儿、节点语法、跨栏目目标和同栏目跨列表目标。
- 复合动作、导航、原生提交、删除、撤回、上传、授权和验证保持受限；本阶段没有任何点击或填写行为。
- 49 项定向语义测试和完整 `npm run check` 通过；全套共 273 项测试通过，独立复审未发现剩余 P0/P1。
- 下一轮 I-002 将在脱敏夹具上实现 Page/Section/Field/Action 的只读构图，并用严格校验器验证每个扫描字段恰好出现一次。

### 2026-09-26 · I-002A

- 新增固定白名单栏目分类器，覆盖基本信息、求职意向、教育、校内职务、实习、项目、奖励、论著、语言、技能和家庭信息；具体项目名、公司名、操作提示和冲突标题均降级。
- 扫描结果新增可选只读语义图，现有字段列表和填写消息保持兼容；私有 DOM 目标只留在内容脚本内存中。
- 字段严格从现有 `controls` 注册表一一映射；支持顶层页面、开放 Shadow DOM、同源 iframe 和嵌套 iframe 的数字路径。
- 图中只保存固定栏目名与规范动作名，不保存输入值、文本域内容、页面标题、URL、DOM id/name 或原始按钮文案。
- 构图期间不点击、不聚焦、不派发事件、不滚动、不修改 DOM；默认 submit、上传、导航和未知动作保持受限。
- 当前只纳入不依赖记录目标的动作；添加、编辑、保存、取消和删除候选在建立真实 RecordList/Record 前主动省略并计数，禁止伪造目标。
- 修复并覆盖共用 form 多栏目、冲突边界、同名独立栏目、已结束兄弟栏目、祖先禁用、未知 root、500 子节点上限等边界。
- 一次并发全量测试曾使既有暂停/恢复用例超时，单独复跑 10.12 秒通过；最终无并发 `npm run check` 为 16 个测试文件、328 项测试及生产构建全部通过。
- 两轮独立复审最终均未发现剩余 P0/P1。

下一步 I-002B 执行提示词：

```text
阅读 I-002A 的语义图、严格验证器和安全测试。先用脱敏夹具表达一个重复记录栏目：栏目容器、两个已有摘要卡片、添加按钮、一个打开的编辑器、字段、保存与取消。只在 DOM 结构能证明所属关系时创建 RecordList/Record，并把 add 指向 RecordList，把 edit/save/cancel/delete 指向同一结构内的 Record；无法证明目标的动作继续省略。不得点击、聚焦、滚动、修改页面或读取当前字段值。验证同名栏目不跨区绑定、已有卡片计数准确、编辑器状态准确、所有 target 均为同栏目祖先，并运行专项测试与 npm run check。
```

### 2026-09-26 · I-002B

- 语义图契约升级至 schema v2，记录列表只能直属可重复栏目，记录只能直属列表；已有摘要数量、连续索引和编辑器状态均由验证器强制检查。
- 新增纯只读 `recordStructureDetector`：首批识别教育、校内经历、实习、项目、奖励、论著、语言、技能和家庭栏目中的标准列表卡片。
- 只有“显式新增 + 每张卡片的唯一编辑/删除”能够建立摘要记录；保存、取消只绑定到已确认编辑器，所有定向动作都必须直属其目标。
- 创建态由明确新增编辑器标题确认；编辑态必须由唯一摘要卡片的 `aria-controls` 或 `aria-owns` 关系确认，只有“编辑”文案而没有结构关系时保持 `unknown`。
- 编辑器字段只从扫描器已经归入同一栏目的字段中接管；每个 `fieldId` 仍恰好出现一次，同名栏目、跨 frame、导航列表、双列表和多个编辑器均失败关闭。
- 图中不保存卡片正文、按钮原文、URL、DOM id/class/name 或字段值；连续构图不读取 input/textarea 的实时值，也不点击、聚焦、派发事件、滚动或修改 DOM。
- 专项覆盖两个项目卡片、单卡片、创建/编辑/未知编辑器、两个同名栏目、普通基础表单、孤立动作、导航、双列表、多个编辑器和隐私回归。
- 完整 `npm run check` 通过：17 个测试文件、343 项测试及生产构建全部成功。
- 完整 `npm run test:e2e` 通过：12 项扩展检查和 7 项连续流程检查；外部请求、最终提交与删除均为 0，六项目仍各新增和保存一次。

下一步 I-002C 执行提示词：

```text
在 I-002B 已验证的只读记录拓扑上增加第二阶段上下文分类。只有在 RecordList/RecordEditor 已由独立结构证据确认后，才把列表内裸“+”解释为新增，把编辑器内原生 submit 且名称严格为“保存/Save”解释为 save-record；原生 submit 的风险仍为 restricted。补充明确空列表、只有编辑入口的标准摘要卡片和隐藏模板夹具。任何上下文冲突、多个候选目标、导航/下拉/日期结构都继续省略。不得点击、填写或读取实时字段值；运行专项测试、npm run check 和浏览器 E2E，并更新本计划。
```

### 2026-09-27 · I-002C

- 裸“+”只在已证明的显式记录列表内提升为可逆新增；下拉、菜单、页签、树、表格、步进器、折叠触发器、弹出控件和导航链接继续省略。
- 原生 submit 只有在严格确认的记录编辑器内且名称精确为“保存/Save”时才转为 `save-record`，并保留 `restricted` 风险；“保存并提交”等最终提交文案不会被降级。
- 编辑器必须由唯一 `aria-controls/aria-owns` 关系，或角色一致的新增/编辑标题证明；未解析、多目标、跨栏目、指向非编辑器控件或记录类型冲突的关系均失败关闭。
- 支持明确空列表、只有编辑入口的两张以上标准摘要卡片、重复普通 `div` 卡片、栏目标题栏中的唯一新增入口，以及共用 form 和开放 Shadow DOM 中由标题限定的栏目范围。
- 精确记录数会在分页、加载中、虚拟窗口、ARIA 总数/位置不完整、只读卡片漏计或多个列表候选时主动省略；外置新增按钮不能被相邻列表抢占。
- 未识别同级标题会终止前一栏目；卡片内重复的低层级或同级栏目标题不会覆盖真正的栏目标题。隐藏模板、行内编辑器、导航列表和跨栏目控制关系均有失败关闭回归。
- 构图仍为纯只读操作，不点击、聚焦、滚动、派发事件或读取实时字段值；序列化结果不包含卡片正文、页面标题、URL、DOM id/class/name 或个人字段值。
- 专项拓扑测试 37 项通过；完整 `npm run check` 通过 17 个测试文件、371 项测试及生产构建。
- 完整 `npm run test:e2e` 通过 12 项扩展检查和 7 项连续流程检查；外部请求、页面错误、最终提交与删除均为 0，六项目仍各新增和保存一次。

下一步 I-003 执行提示词：

```text
阅读 I-002C 的只读语义图、现有流程等待逻辑和安全测试。先定义一个与站点无关、可取消且有硬超时的 DOM 稳定等待器：只观察指定根节点和白名单结构变化，在满足预期谓词后连续经历静默窗口才返回 stable；明确区分 stable、timeout、aborted、root-disconnected 和 predicate-failed，不把超时当成功。用延迟出现、连续突变、无关突变、根节点替换、开放 Shadow DOM、主动取消和硬超时夹具先写失败测试，再实现 MutationObserver 生命周期与清理。不得点击、填写、滚动、读取个人值或无限等待；完成后运行专项测试、npm run check 和浏览器 E2E，并更新 PROJECT_PLAN.md。
```

### 2026-09-27 · I-003

- 新增站点无关的 `waitForDomStability`，使用 `stable / timeout / aborted / root-disconnected / predicate-failed` 判别联合，超时不会再与成功共用 `undefined`。
- 条件首次满足后仍需经历完整静默窗口；相关结构变化会重读条件并重新计时，无关变化可由过滤器排除，正文变化默认不观察但可显式启用。
- 硬超时使用单调时钟且上限为 60 秒；AbortSignal、谓词异常、过滤器异常、根断连和初始化拓扑异常都有独立终态，并由同一个清理出口释放观察器、监听器和计时器。
- 同步谓词在类型层和运行时同时强制；误传 rejected Promise 时会先消费拒绝，再返回 `predicate-failed`，不会向网页泄漏 `unhandledrejection`。
- 根节点替换、跨父容器移动及同一任务内移除再挂回均失败关闭；祖先链上限 256，嵌套 frame 上限 10，避免异常页面在计时器安装前制造无界同步工作。
- 支持开放 Shadow DOM、同源 iframe 与嵌套 iframe；iframe 移除、预先断连、`src/srcdoc` 改变、Navigation API 导航、`pagehide` 和 `beforeunload` 均使旧根失效。
- 动作后置条件必须先创建等待器，再触发动作；已经发起但尚未提交的导航没有可靠的通用追溯信号，后续 Transaction Executor 必须保持这个事务顺序。
- 新增 27 项专项测试和独立真实 Chromium 回归，覆盖 9 类浏览器边界；真实浏览器中无未处理拒绝、页面错误或网络外泄。
- 完整 `npm run check` 通过：18 个测试文件、398 项测试及生产构建。
- 完整 `npm run test:e2e` 通过：9 项 DOM 浏览器检查、12 项扩展检查和 7 项连续流程检查；外部请求、页面错误、最终提交与删除均为 0，六项目仍各新增和保存一次。
- 现有 `until` 暂不替换；它仍承担旧流程的暂停心跳。I-004B 接入前必须为每次运行建立 AbortController，并将 `aborted` 映射回 `Suspended`。

下一步 I-004A 执行提示词：

```text
阅读 I-002C 的 Page Semantic Graph、I-003 的稳定等待契约、现有中国移动记录流程和安全测试。先定义完全纯函数的 Record Planner 契约：档案记录意图、网页记录候选、唯一身份证据、计划步骤、动作节点引用、前置条件、后置条件和 request-human 原因。只允许引用已经验证的语义节点 ID，不保存 DOM、选择器、页面原文或个人字段值；已有记录与档案记录必须做一对一分配，重复候选、身份不足、列表计数不完整、编辑器占用或缺少唯一 add/save 动作时失败关闭。用六条档案记录、部分已有、重复身份、顺序不同、空列表和歧义夹具先写失败测试，再实现计划生成；本阶段不得点击、填写、滚动或接入大模型。完成后运行专项测试与 npm run check，并更新 PROJECT_PLAN.md。
```

### 2026-09-28 · I-004A

- 新增去敏 `RecordPlannerSnapshot`：从已验证的 Page Semantic Graph 只投影记录类型、计数、编辑器状态、语义节点 ID 与动作风险，不保留页面文字、字段值、选择器、DOM、结构指纹或值哈希。
- 档案意图与网页卡片采用完整的两两身份矩阵和一对一分配；相同、不同、证据不足、行重复、列重复及混合歧义分别失败关闭，诊断包含完整歧义端点。
- 候选、比较与事务全部绑定运行令牌和快照令牌；快照、计划和事务均深度冻结，并用模块私有 WeakSet/WeakMap 验证对象来源，序列化复制、反射品牌复制和普通对象伪造均不能获得动作授权。
- 事务能力只能沿 `open-create → add-invoked → populate-editor → fields-verified → save-created → save-invoked` 推进；每个计划和前序能力只能消费一次，同一快照重复规划也不能消费第二份新增授权。
- 新增与保存只接受精确风险等级：新增必须为 `reversible`，保存必须为 `commit`；禁用、缺失、多候选、`restricted` 或风险提升均停下请求人工处理。
- 保存成功必须同时满足：编辑器关闭、记录数恰好加一、全部旧候选句柄仍存在、恰好出现一个新句柄，并且当前档案意图唯一匹配该新句柄；旧卡片不能冒充新保存记录。
- 运行时输入增加失败关闭校验：null 元素、非法枚举、超大数值 ID、非连续档案序号、令牌复用、跳代快照、编辑器替换和字段能力重放均不会抛异常或泄漏输入内容。
- 49 项 Record Planner 专项测试通过；完整 `npm run check` 通过 19 个测试文件、447 项测试及生产构建。
- 完整 `npm run test:e2e` 通过 9 项 DOM 浏览器检查、12 项扩展检查和 7 项连续流程检查；外部请求、页面错误、最终提交与删除均为 0，六项目仍各新增和保存一次。
- 当前 `recordFieldsVerified` 是执行器受信调用边界；I-004B 必须用逐字段回读收据、`editorRevision` 与 `profileRevision` 替代单纯的调用约定，字段被用户或网站再次修改后旧收据必须失效。

下一步 I-004B 执行提示词：

```text
阅读 I-004A 的去敏 Record Planner 契约、I-003 的 DOM 稳定等待器、现有 scanner semanticTargets 与中国移动旧流程。先实现只存在于内容脚本内存中的 RunContext 和 CandidateContinuityTracker：由内部生成 run/snapshot/transaction token，跨重扫仅在结构证据足够时延续 candidateHandle 和 editorHandle；令牌、句柄、字段值及其哈希不得写入 storage、消息日志或问题报告。实现绑定 transactionToken、snapshotToken、editorHandle、editorRevision 和 profileRevision 的 FieldsVerifiedReceipt，只有逐字段回读全部成功后才能签发；任一 input/change/reset、编辑器替换或档案修订都使旧收据失效。随后实现最小 Transaction Executor，只消费当前快照的一步授权：执行前重新核对计划能力、快照、动作节点、风险、目标和前置条件，先安装 waitForDomStability 再点击 add/save；稳定后重扫、重建去敏快照并重新规划。每个 `(run, snapshot, step)` 只能消费一次，pause/stop 必须由 AbortController 取消；uncertain add/save、用户草稿、句柄连续性丢失或后置条件失败时 request-human，永不重试提交动作。先用六项目、部分已有、卡片重排、延迟保存、保存生成错误卡、编辑器替换、字段核验后被修改、重复消息和暂停恢复夹具写失败测试；本轮 populate-editor 使用脱敏虚构 binder 或测试桩，不接入陌生站真实个人值。最终提交、删除、上传和 next-step 始终为零。完成后运行专项、npm run check 和浏览器 E2E，并更新本计划。
```

### 2026-09-28 · I-004B-A

- 新增内容脚本内存专用 `RecordRunContext`；运行令牌与每次快照令牌由内部生成，快照版本、候选句柄、编辑器句柄、档案修订号和编辑器修订号均为有界计数。
- 候选连续性只依据同一运行中连续两次快照的 DOM 对象身份、列表对象身份和记录类型；卡片重排可延续句柄，卡片离开一轮后重现、DOM 替换、跨列表移动或列表替换都会获得新句柄。
- 记录列表、摘要卡片和编辑器目标必须存在、仍连接、位于同一文档且具有可证明的包含关系；多个语义记录指向同一 DOM 元素、目标表抛错或来源畸形时失败关闭。
- 编辑器句柄只跟随同一个编辑器 DOM 实例及所属表单；`input`、`change`、编辑器内 `reset` 和所属表单 `reset` 只递增修订号，不保存字段值、页面文字、值哈希或 DOM 到返回结果。
- `beginStep` 为每一步建立新的 AbortSignal，并自动取消尚未结束的旧步骤；`cancelStep` 与 `stop` 会立即中止等待，停止后的运行不能恢复捕获。
- 捕获结果、候选及编辑器候选均冻结；候选默认 `identityReady: false`，必须经过后续身份比较才能交给 Planner 自动执行。
- 7 项专项测试和完整 `npm run check` 通过：20 个测试文件、454 项测试及生产构建全部成功。本阶段未接入消息入口或真实点击，因此沿用 I-004A 已通过的完整浏览器 E2E 作为用户行为基线。

下一步 I-004B-B 执行提示词：

```text
阅读 RecordRunContext、Record Planner 能力链和 waitForDomStability。先定义不可伪造、不可序列化复用的 FieldsVerifiedReceipt：收据必须由当前 issued populate-editor 计划、活动事务、RecordRunCapture、editorHandle、editorRevision、profileRevision 和完整 fieldNodeId 集共同签发；签发前由脱敏测试 binder 逐字段写入并即时回读，任一字段失败则不签发。把 recordFieldsVerified 改为必须消费该收据，并把 editorRevision/profileRevision 写入后续事务；保存规划前重新捕获，字段 input/change/reset、编辑器或表单替换、档案修订、快照跳代及收据重放均失败关闭。随后建立只执行一个计划步骤的 TransactionExecutor：执行前核对当前快照和 semanticTargets，先安装 DOM 稳定等待器再点击 add/save，动作计划与 `(run,snapshot,step)` 只消费一次；timeout、aborted、root-disconnected 或后置条件不唯一时请求人工处理且不重试。先用虚构 DOM 与 binder 覆盖正常链、字段被改、重复消息、延迟编辑器、延迟保存、错误新卡、暂停和停止；不接入真实档案，不触发 delete、upload、next-step 或最终 submit。完成后运行专项与 npm run check；只有接入内容脚本消息入口后再运行完整浏览器 E2E。
```

### 2026-09-28 · I-004B-B1

- 新增不可伪造、不可序列化复用的 `FieldsVerifiedReceipt`；收据只由已签发的 `populate-editor` 计划、活动 add 事务和填后新快照共同产生。
- 签发时逐一同步回读计划中的全部字段节点；回调抛错、返回 false、返回 Promise、字段集合变化、编辑器不一致、快照非紧邻或档案修订非法均不签发。
- 收据绑定 run、transaction、源计划快照、填后快照、记录列表、档案序号、编辑器节点、editorHandle、editorRevision、profileRevision 和字段节点集合；只保存语义 ID 与有界计数，不保存字段值或哈希。
- `recordFieldsVerified` 现在必须消费真实收据；普通对象、浅拷贝、structuredClone、篡改副本、重复收据或已经推进的事务均不能进入 `fields-verified`。
- fields/save 事务携带 editorRevision 与 profileRevision；下一次保存规划必须看到同一编辑器修订和档案修订，字段 input/change/reset、编辑器替换或档案变更都会返回 `active-transaction-mismatch`，不产生保存动作。
- Planner 与 RunContext 共 58 项专项测试通过；完整 `npm run check` 通过 20 个测试文件、456 项测试及生产构建。本阶段仍未接入真实页面动作。

下一步 I-004B-B2 执行提示词：

```text
实现只消费一个已签发 RecordPlanStep 的 TransactionExecutor。输入必须包含当前 RecordRunCapture、当前 ScanState.semanticTargets、活动事务和 RunContext；执行前重新核对计划来源、run/snapshot/version、动作节点、目标节点、风险、disabled 状态、editorHandle/editorRevision/profileRevision 与全部 preconditions。open-create/save-created 先对目标根安装 waitForDomStability，再用 semanticTargets 中当前且连接的 Element 触发一次 click；waiter 只有在重扫后的语义后置条件唯一成立并经历静默窗口后才成功。populate-editor 先用纯虚构 binder 逐字段写入并即时回读，然后重扫并原子签发/消费 FieldsVerifiedReceipt。每个 snapshot+step 只能消费一次；重复消息、timeout、aborted、root-disconnected、predicate-failed、动作目标替换、字段再次变化或结果不唯一时返回 request-human，绝不重试 add/save。用延迟编辑器、延迟保存、错误新卡、重复消息、暂停、停止和目标替换夹具验收；delete、upload、next-step、submit 的点击计数必须始终为零。完成专项与 npm run check 后再决定是否接入内容脚本消息入口。
```

### 2026-09-28 · I-004B-B2

- 新增只执行一个已签发 `open-create` 或 `save-created` 步骤的 `TransactionExecutor`；计划必须由 Planner 签发并绑定当前捕获的同一个冻结快照对象。
- `RecordRunContext` 为捕获结果建立不可伪造的内存标记，并保存与语义节点对应的 DOM 对象身份；当前目标缺失、断连、移位或被新 DOM 替换时零点击失败关闭。
- 执行前重新核对 run/snapshot/version、动作类型、targetId、风险、disabled、包含关系与保存事务能力；缺少真实 fields-verified 事务时保存按钮保持零点击。
- 对列表根先安装 `waitForDomStability`，再调用一次动作元素的 `click`；静默窗口结束后只允许一次同步重扫，并要求快照版本严格相邻、档案修订未变且新增/关闭编辑器的计数和连续句柄后置条件成立。
- 同一快照与步骤在异步等待前原子预留；并发重复消息最多点击一次。点击抛错、timeout、aborted、root-disconnected、predicate-failed、重扫失败或后置条件不唯一均把能力永久标为 uncertain，不自动重试。
- 修复了旧快照可重新规划新增能力的漏洞：只要该快照发生过新增尝试，等价重规划也返回 `add-result-uncertain`。
- 6 项执行器专项与 Planner/RunContext 共 64 项专项通过；完整 `npm run check` 通过 21 个测试文件、462 项测试及生产构建。执行器尚未接入内容脚本入口，因此未增加真实页面点击面。

下一步 I-004B-B3 执行提示词：

```text
阅读 TransactionExecutor、FieldsVerifiedReceipt、RecordRunContext 和 scanner semanticTargets。实现仅存在于内容脚本内存中的 Editor Binder 契约：它只消费当前 issued populate-editor 计划、相邻 RecordRunCapture、精确 editorHandle/editorRevision/profileRevision 和完整 fieldNodeId 集；字段目标必须仍是捕获时的同一 DOM 对象、位于同一编辑器且可编辑。先用虚构 ProfileFieldProvider 提供值，不读取真实档案，不把值、哈希、DOM、令牌写入日志或 storage。默认保留非空原值；逐字段使用原生 setter 与 input/change 事件写入，并立即用控件语义回读；任一字段失败时撤销本轮可逆写入或 request-human，绝不点击保存。成功后必须重新捕获相邻快照，再原子签发并消费 FieldsVerifiedReceipt，字段事件造成的 editorRevision 变化要与填后捕获精确绑定。覆盖 input、textarea、原生 select、radio/checkbox、不可编辑、自定义控件拒绝、字段目标替换、已有值保护、部分写入失败、档案修订变化、重复消息、暂停和停止；不接入真实个人值，不点击 add/save/delete/upload/next-step/submit。完成专项和 npm run check 后再决定是否接入内容脚本消息入口。
```

### 2026-09-28 · I-004B-B3

- 新增只消费当前 issued `populate-editor` 计划的脱敏 `RecordEditorBinder`；绑定器要求精确的 capture、add 事务、RunContext、语义图和 DOM 目标身份。
- 值提供器只接收字段节点 ID 与扫描字段 ID；值只在当前调用内存中流转，不进入返回结果、哈希、日志或 storage。本阶段测试全部使用虚构值。
- 支持普通 input、textarea、原生 select 与普通 radio；checkbox、移动站自定义选择器、blocked 字段及陌生自定义控件失败关闭，不尝试点击。
- 已有值与预期相同则保留并回读；已有值冲突时整批零写入。字段 DOM 被替换、移出编辑器或扫描映射不一致时同样零写入。
- 复用已有安全填写器的原生 setter、事件、格式/长度/选项验证与整批延迟复核；任一后续字段失败时，之前的可逆写入按扫描时原始状态倒序恢复，不覆盖网站联动产生的新结果。
- 写入成功后只重扫一次，要求严格相邻快照与未变化的档案修订；随后逐字段即时回读并原子签发、消费 `FieldsVerifiedReceipt`。绑定器本身从不点击保存。
- 4 项绑定器专项与执行链相关 61 项专项通过；完整 `npm run check` 通过 22 个测试文件、466 项测试及生产构建。真实档案与内容脚本入口仍未接入。

下一步 I-004B-C 执行提示词：

```text
阅读 RecordPlanner、RecordRunContext、TransactionExecutor、RecordEditorBinder 和现有内容脚本消息生命周期。先实现不接 UI 的内存 RecordTransactionOrchestrator：输入为一次新扫描、去敏的记录意图/身份比较和值提供器；每轮只捕获、规划并调度一个 open-create、populate-editor 或 save-created 步骤，步骤成功后必须使用返回的新 capture 重新规划，禁止在一个旧快照上连续操作。为每个列表维持唯一活动事务和明确 paused/stopped/request-human/completed 状态；pause/stop 传播到 RunContext，恢复必须重新扫描而不是复用旧能力。用六个虚构项目、两个页面已有、卡片重排、保存生成错误卡、编辑器替换、已有草稿、重复消息、延迟新增/保存和中途暂停构建端到端夹具；只有身份唯一的新卡才能完成对应 intent，错误新卡和计数异常必须 request-human。所有 delete、upload、next-step、submit 点击计数保持为零。先完成纯模块测试与 npm run check，再以独立显式消息接入内容脚本并运行完整浏览器 E2E；在真实站点试用前保留功能开关。
```

### 2026-09-29 · I-004B-C1

- 新增内存 `RecordTransactionOrchestrator`，每次 `advance()` 只允许规划并调度一个 open、populate 或 save 步骤；成功结果必须携带同一运行的严格相邻捕获和正确事务阶段。
- 编排器不会在旧快照上连续操作；下一步骤始终重新调用 Planner。完成或 request-human 后停止自动推进，不把中间状态误报为完成。
- 同一编排器只允许一个 in-flight 步骤；并发重复 `advance()` 返回 busy，不触发第二次动作。
- pause 会取消 RunContext 当前步骤并丢弃快照；resume 必须重新捕获。暂停/停止期间到达的异步成功结果由 generation 屏障丢弃，不能恢复为 ready。
- 暂停跨越 add 事务后，重新扫描因快照不再相邻而返回 `active-transaction-mismatch`；保留这一失败关闭规则，要求人工确认实际页面状态。
- 4 项编排专项及执行链相关 65 项专项通过；完整 `npm run check` 通过 23 个测试文件、470 项测试及生产构建。尚未接内容脚本入口。

下一步 I-004B-C2 执行提示词：

```text
在纯模块夹具中把 RecordTransactionOrchestrator 接到真实 TransactionExecutor 与 RecordEditorBinder，构造六个虚构项目、两个页面已有记录的完整循环。每次新增、填写、保存后重扫并重新生成候选身份比较；保存产生的新卡只有与当前 intent 唯一 same 且其他 intent 为 different 时才消费 save-invoked 事务。覆盖卡片重排、错误新卡、重复摘要、保存未关闭编辑器、计数跳变、已有草稿和中途暂停；错误或不足身份一律 request-human，绝不继续新增。断言 add/save 次数等于实际缺失记录数，delete/upload/next-step/submit 始终为零。完成专项和 npm run check 后，再设计有功能开关的内容脚本入口与完整浏览器 E2E。
```

### 2026-09-29 · I-004B-C2A

- 将真实 Planner、TransactionExecutor、EditorBinder 与 Orchestrator 接入同一个纯模块 DOM 夹具，建立六个虚构项目、页面已有两个项目的完整闭环。
- 页面每次保存后都会重排全部摘要卡片；RunContext 仍能依 DOM 对象连续句柄重建一对一身份矩阵，最终只新增缺失的 4 条。
- 正常闭环严格执行 4 次 open、4 次 populate、4 次 save；删除、上传、下一步和最终提交按钮点击数始终为零。
- populate 成功后发现必须额外捕获一次相邻快照再规划保存；编排器现在主动丢弃收据快照，防止网站在填后异步改写字段却沿用旧收据。
- 保存若生成属于另一 intent 的错误新卡，下一次身份复核返回 `save-result-uncertain`，编排器立即停止且不会新增后续项目。
- 将集成测试等待上限从易受并行负载影响的 300ms 调整为生产默认级 2s；同一用例连续 3 次及完整并行套件均稳定通过。
- 完整 `npm run check` 通过 24 个测试文件、472 项测试及生产构建。内容脚本入口仍未接入。

下一步 I-004B-C2B 执行提示词：

```text
扩展多记录 DOM 夹具，覆盖保存后一次增加两张卡、保存后编辑器未关闭、已有摘要重复匹配同一 intent、字段存在冲突草稿以及 populate/save 之间网站二次修改字段。逐项断言 request-human 原因、add/save 次数停止在异常发生处，且 delete/upload/next-step/submit 始终为零。修正任何暴露的跨步骤状态漏洞，重复运行专项与完整 npm run check。全部对抗场景通过后才把编排器标记 verified，并进入带功能开关的内容脚本入口设计。
```

### 2026-09-29 · I-004B-C2B

- 多记录夹具新增五类对抗场景：保存后增加两张卡、保存后编辑器不关闭、两个摘要重复匹配同一 intent、编辑器存在冲突草稿、字段核验后网站二次改写。
- 计数一次增加两张卡时保存后置条件直接失败；编辑器不关闭时等待超时并永久关闭保存能力，两者均不会自动重试。
- 重复摘要在首次规划即返回 `duplicate-page-record`，新增与保存点击均为零。
- 冲突草稿保持原值并返回 `existing-value-conflict`；字段核验后发生 input 事件会提升 editorRevision，下一次保存规划返回 `active-transaction-mismatch`。
- 7 项多记录正常/异常闭环全部通过；所有异常发生后 add/save 次数固定，delete/upload/next-step/submit 始终零点击。
- 完整 `npm run check` 通过 24 个测试文件、477 项测试及生产构建。I-004B-C 编排层达到模块验收标准。

下一步 I-004B-D 执行提示词：

```text
设计默认关闭的 repeatable-record-v2 功能开关和独立内容脚本消息入口。入口只接收启动、单步推进、暂停、恢复、停止和状态读取；不得从消息传入 Planner 能力、DOM 节点、令牌或任意回调。内容脚本内部从最新 scanDocument 构造 RunContext、身份比较和值提供器，并只在明确启用且页面/档案版本一致时创建 Orchestrator。先接入纯虚构测试档案与测试页面，保持现有移动站工作流和逐字段填写路径不变；为消息重复、页面导航、扩展重载、开关关闭、暂停/停止和 request-human 建浏览器 E2E。确认 delete/upload/next-step/submit 零点击后，再决定真实档案适配和受控试用范围。
```

### 2026-09-29 · I-004B-D1

- 新增默认关闭的 `repeatable-record-v2` 构建期开关；当前生产包不会创建会话，也不会改变现有逐字段填写或中国移动连续流程。
- 内容脚本新增独立的 start、advance、status、pause、resume、stop 消息；六种消息均为严格空载荷，档案、字段值、选择器、DOM、Planner 能力和回调不能从扩展页面注入。
- 新增 `RecordV2Gateway` 作为可信生命周期边界；会话只能由内容脚本内工厂创建，单次 advance 只转发一个步骤，并保留 pause、resume 与 stop 的状态。
- 页面 origin、path 或 query 变化会停止并丢弃旧会话；推进中的迟到结果也会失效。并发状态读取不会重复停止同一会话。
- request-human 由网关保持为终止态；在用户停止并重新启动前不能继续推进，避免歧义后仍执行下一步。
- 新增 6 项网关测试和 1 项内容消息边界测试；完整 `npm run check` 通过 25 个测试文件、484 项测试和生产构建。
- 首次聚合浏览器回归中，DOM 与扩展检查通过，工作流首段等待发生一次 15 秒时序超时；工作流单独重跑通过，随后完整 `npm run test:e2e` 重跑通过 9 项 DOM、12 项扩展和 7 项工作流检查。外部请求、页面错误、删除与最终提交均为 0。

下一步 I-004B-D2 执行提示词：

```text
保持 repeatable-record-v2 的发布默认值为 false。建立一个只在本地虚构 E2E 页面、明确测试构建标记和固定页面指纹同时满足时才可创建的内部 SessionFactory；消息不得携带档案、字段值、选择器、DOM 或计划。工厂从内容脚本内固定虚构记录意图、scanDocument、RecordRunContext、RecordPlanner、TransactionExecutor、RecordEditorBinder 和 RecordTransactionOrchestrator 组成会话，每次 RA_RECORD_V2_ADVANCE 只推进一步。浏览器 E2E 覆盖禁用构建、非法消息载荷、重复 start、并发 advance、暂停/恢复、页面导航、request-human、扩展页面重开，以及六条虚构项目中两条已有、四条新增的完整循环；断言 add/save 各 4 次，delete/upload/next-step/submit 永远为 0。测试页面之外必须始终返回未启用或驱动未安装。完成后运行专项、npm run check 和完整 npm run test:e2e，再评估是否为真实档案建立只读适配层。
```

### 2026-09-29 · I-004B-D2

- 构建脚本新增独立 `RA_RECORD_V2_TEST_BUILD=1` 测试开关；普通 `npm run build` 明确定义为关闭，真实生产 MV3 回归也断言 `state: disabled`。
- 测试会话只有在 localhost 固定路由、HTML 根标记、meta 指纹和容器 schema 四项同时匹配时才可创建；测试构建中的其他页面不能安装驱动。
- 会话工厂使用真实 `scanDocument`、`RecordRunContext`、Planner、TransactionExecutor、EditorBinder 与 Orchestrator，没有绕过执行链或直接填写 DOM。
- 固定虚构档案包含六个项目；页面已有两条，剩余四条严格按 open、populate、save 共 12 个单步完成。卡片每次保存后重排，仍保持一对一身份匹配。
- 专项 MV3 覆盖严格空载荷、重复 start、并发 advance、暂停恢复、扩展页重开、SPA 路由变化、身份证据损坏和完整闭环；add/save 各 4 次，delete/upload/next-step/submit 均为 0。
- 浏览器测试暴露了内部编排结果的额外属性可能经对象展开泄漏令牌和节点 ID；网关已改为白名单重建公开结果，并加入内部令牌不得出现在序列化响应中的回归测试。
- 修正旧工作流 E2E 的启动竞态：先确认第一条任务已开始，再关闭 popup 验证剩余任务继续执行，避免异步档案尚未读取完就销毁 popup 导致的假超时。
- 完整 `npm run check` 通过 26 个测试文件、487 项测试与生产构建；完整 `npm run test:e2e` 通过 9 项 DOM、12 项生产扩展、7 项中国移动工作流和 5 项 Record v2 测试构建检查。全部外部请求、页面错误、删除和最终提交计数为 0；测试结束后自动恢复生产构建。

下一步 I-004B-D3 执行提示词：

```text
保持生产 repeatable-record-v2 开关关闭，也不要把真实档案放入测试夹具或消息参数。设计后台可信档案投影协议：只有本扩展注入的顶层内容脚本、当前 activeTab 且由用户操作获得权限时，才能向 service worker 请求一个固定记录类型的最小只读投影；后台从受限 chrome.storage.local 读取并用现有 UserProfile schema 校验，只返回该记录类型允许的字段、档案修订号和不含原值的身份槽位描述，不返回 basic 身份证、手机号、邮箱或完整档案。请求不能携带字段路径、选择器、代码或任意回调。先仅支持虚构测试构建的 project 投影，并证明页面脚本无法读取、popup 不能伪装 content sender、失效 tab/导航/修订会停止会话；所有响应和错误日志不得含个人值。完成单元与真实 MV3 测试后，再把固定 fixture intent/value provider 替换为投影适配器，生产开关仍保持关闭。
```

### 2026-09-30 · I-004B-D3

- 新增严格空载荷 `RA_PROFILE_PROJECT` 请求；请求不接受字段路径、选择器、DOM、计划、回调或任意 profile key。
- Service worker 只接受同扩展、带网页 tab、HTTP(S) sender；popup、普通网页伪造、扩展页和无 tab sender 都被拒绝。
- 后台从 `TRUSTED_CONTEXTS` 的本地档案读取并通过现有 schema 校验，只投影 `projects` 及 `profileRevision`；basic、internships、education、family、skills 和常用回答不进入响应。
- 投影记录仅包含项目引擎需要的 id、名称、角色、组织、日期、描述、职责、成果和技术列表；响应和错误不携带异常详情。
- 新增投影序列化、冻结、严格请求、sender 身份、读取失败和无关数据排除测试；生产 MV3 回归已从真实内容脚本请求投影并确认通过。
- 完整 `npm run check` 通过 27 个测试文件、493 项测试；现有普通字段、旧中国移动流程和 Record v2 测试页保持不变，生产 Record v2 仍关闭。

下一步 I-004B-D4 执行提示词：

```text
把固定虚构 SessionFactory 的 value provider 改为内部 ProjectProjectionProvider，但仅在测试构建且固定 localhost 页面指纹通过时启用；生产构建继续 false。内容脚本启动会话前发送严格空载荷 RA_PROFILE_PROJECT，校验返回 recordType、profileRevision、项目 id 和字段类型，随后把项目记录投影转换为值提供器。会话每次 capture/advance 前检查投影修订号未变化；档案更新、响应结构异常、项目 id 重复、未知字段、页面导航或消息超时立即 request-human，不重试 add/save。增加“投影中途修订”“投影值缺失”“重复 id”“后台响应注入额外属性”“真实页面非测试指纹永远不创建会话”的单元和 MV3 测试。不要把任何投影值写入日志、storage、错误报告或消息回传；生产开关保持关闭。
```

### 2026-09-30 · I-004B-D4

- 测试构建启动会话前通过严格空载荷 `RA_PROFILE_PROJECT` 获取真实 options 页保存的项目投影；fixture 不再内置项目事实。
- 六项目页面仍严格完成两条已有记录和四条新增记录，新增值来自投影，内容脚本只保留冻结后的最小投影副本。
- 每次单步推进前刷新并比较 `profileRevision`；档案在中途变化时进入 request-human，且不会继续执行 save 或新增动作。
- 增加投影客户端结构校验、重复项目 id、修订变化停止等测试；完整 `npm run check` 通过 28 个测试文件、493 项测试与生产构建，Record v2 专项浏览器测试通过。

下一步 I-004B-D5 执行提示词：

```text
先建立 ControlAdapter 抽象和失败夹具，不改变生产 repeatable-record-v2 默认关闭。覆盖原生 input、textarea、select、radio/checkbox，以及带稳定 aria combobox/listbox 的常见控件：读取当前值、打开控件、列出唯一选项、选择、写入、等待 React/Vue/异步回填并核验最终值；已有非空值必须保护，日期、证件类型、学校代码等无法唯一映射时 request-human，禁止按第一个选项猜测。把现有 EditorBinder 的原生路径迁移到适配器，保留脱敏收据和目标替换检查。新增 React 受控 input、Vue 异步 select、portal listbox、动态替换节点和未知自定义控件夹具；未知控件必须停下，不执行点击风暴。专项、npm run check、完整 npm run test:e2e 全部通过后，再决定是否将适配器接入真实页面白名单。
```

### 2026-09-30 · I-004B-D5（进行中）

- 新增 `ControlAdapter` 抽象，按控件边界提供读取、打开、选项枚举、写入和核验接口；原生 input、textarea、select 使用当前页面所属 realm 的安全 setter，避免跨 iframe 构造器误判。
- 原生控件已有值保持不覆盖；select 只有唯一、非禁用、非占位选项才允许写入；空答案和无效回读都会 request-human。
- ARIA combobox 只扫描有唯一显式 `aria-controls/aria-owns` listbox 绑定的控件；填写时只点击自身并接受唯一可见选项。异步列表、重复选项、未归属 portal 和未知自定义控件不会触发广泛点击。
- `fillScan` 已接入稳定 ARIA combobox；字段以 select 语义进入匹配，缺少绑定、标签、唯一选项或页面节点被替换时保持人工处理。
- 普通 ARIA radiogroup 已以 radio 语义接入；协议、隐私、授权、承诺和声明语义保持人工，单选组已有答案、选项重复或节点变化时不覆盖。
- 普通 ARIA checkbox 已以明确“是/否”语义接入；协议、隐私、授权、承诺和声明语义保持人工，已有“是”不会被自动取消，未选状态只有在档案明确要求“是”时才点击。
- 选项匹配补充了显式布尔别名（true/false、yes/no、有/无等），仍要求网页可见选项唯一，不把任意数字或第一个选项当作答案。
- `fillScan` 的原生 input、textarea、select 路径已改用 ControlAdapter，保留扫描快照、原值保护、候选校验和整批 200ms 回读；radio-group、checkbox、mobile-select 的边界保持原有安全路径。
- 新增 10 项适配器专项及 6 项 ARIA 扫描/填写测试，覆盖动态节点替换、延迟原生 select 选项、唯一 portal listbox、多 portal 拒绝、稳定绑定 combobox、普通 radiogroup 与普通 checkbox；补充布尔选项别名测试。`npm run check` 和完整 `npm run test:e2e` 均通过，当前回归基线为 29 个测试文件、510 项测试。生产 Record v2 仍关闭。

### 2026-09-30 · I-004B-D5c（进行中）

- 本轮先完成 ARIA checkbox 的最小安全适配：只接受明确可映射的“是/否”，不对已有勾选执行取消，不把协议、隐私、授权、承诺或声明类复选框交给自动填写。
- 普通 ARIA checkbox 已进入扫描、匹配、填写和 200ms 留存复核路径；未知自定义控件仍 request-human，不触发广泛点击。
- 相关专项、510 项全量测试、生产构建和完整浏览器 E2E 均通过；浏览器回归中的外部请求、异常、删除和最终提交保持为 0。
- 补充了选项文字与布尔档案答案的安全别名映射；完整质量检查和浏览器回归再次通过。
- ARIA 单选/复选点击后增加 500ms 限时属性等待，覆盖 React/Vue 异步回写；只执行一次点击，超时不重试。

下一步 I-004B-D5c 执行提示词：

```text
为稳定 ARIA radio/checkbox 建立只读扫描和唯一选项描述，先只支持无协议/无授权语义的普通选择；同意、隐私、承诺、文件上传和不可逆按钮继续人工。增加 React 受控 input、Vue/异步 select、portal listbox、节点替换四个真实夹具，验证事件触发后页面状态最终保留值，控件被替换或异步回填冲突时 request-human，不推进记录保存。运行 adapter、binder、scanner 专项、npm run check 与完整 npm run test:e2e。
```

## 8. 每轮通用提示词

```text
阅读 PROJECT_PLAN.md、当前 Git 状态、上一轮记录和相关测试。根据优先级规则选择一个最小可验收工作项，先建立失败夹具，再实施通用修复。保留现有安全边界，不覆盖已有值，不猜测未知事实，不触发删除或最终提交。运行直接相关测试、npm run check；涉及浏览器交互时运行 npm run test:e2e。根据实际结果更新状态板、本轮记录、风险和下一动作。不要为了通过测试而降低断言或删除保护。
```
