# 校招智能网申助手 · 2027

从本地个人档案识别招聘表单，辅助填写普通字段，并逐条新增、填写、保存和核验教育、项目、实习、奖励、专业论著及校内职务。遇到缺少资料、无法唯一判断的字段或不确定的保存结果，会保留待办。

当前正式版本为 **0.6.61**。`codex/semantic-engine` 包含最新开发代码。版本状态以 [活计划](PROJECT_PLAN.md) 和 [验收记录](VERIFICATION.md) 为准。

## 安装与更新

需要 Node.js 22.12.0 或更新版本。在 PowerShell 中先进入项目目录，再执行命令：

```powershell
Set-Location E:\job\recruitment-autofill
npm ci
npm run build
```

在 Chrome 的 `chrome://extensions` 或 Edge 的 `edge://extensions` 打开开发者模式，选择“加载已解压的扩展程序”，加载构建生成的 **dist** 文件夹。更新后重新构建、重载扩展，并在保存网页草稿后刷新招聘页。保留原扩展及浏览器档案，可以沿用本地个人档案。

打开“我的档案”，填写并保存真实资料。缺失或未确认的内容不会自动推测；每段经历分别保存自己的职责、简介、日期和成果。详细步骤见 [安装说明](INSTALL.md)。

## 配置可选模型

普通规则填写可独立使用。模型识别需要本机伴随服务和 OpenAI 兼容 API；密钥只在本机配置，不放入扩展、仓库或招聘页面。

```powershell
Set-Location E:\job\recruitment-autofill
npm run semantic:setup
```

完成配置后运行：

```powershell
npm run semantic:serve
```

保持服务终端运行，在“我的档案 → AI 识别连接”导入本机生成的 `artifacts/semantic-connection.local.json`。供应商配置和输出格式说明见 [兼容 API 指南](docs/COMPATIBLE_API_SETUP.md)。不要把本机配对文件、模型配置或个人档案提交到 Git。

模型只返回可校验的字段含义和有限的下一步任务，答案仍从当前本地档案读取。局部图像识别需要另外启用图像许可，并配置支持图像的模型；本机接口已实现不等于实际云模型已验收可用。

## 使用范围

- 扫描页面后查看匹配结果，可填写高置信度字段，或核对候选后确认填写；已有值受到保护。
- “Agent 连续填写本页（试用）”可推进支持的普通字段和六类经历，核验每条保存结果并去重。运行期间保持弹窗打开，停止或关闭会取消后续操作并保留网页草稿。
- 原生控件及部分具有稳定 ARIA 绑定的控件可以填写；可核验的陌生空下拉框可以展开观察后重新识别。
- 文字无法识别的有限原生空字段，可在单独许可后尝试局部截图；仅保留已核验的原标签区域，输入框及周围像素遮挡。独立截图入口只提供待确认候选。
- Agent在单独图像许可有效时，可先定位首个屏外原生未知空字段，再重扫、识别并填写该原目标；其他视口继续保留待办。已有模型核对候选时不移动。独立截图入口仍需手工调整位置。

跨域 iframe、封闭 Shadow DOM、部分特殊日期/级联、自定义组件和无法核验的标签布局仍可能需要人工处理。验证码、上传、协议授权和最终投递由本人完成。自动化测试使用虚构资料和本机模型上游，**尚未代表真实云模型或登录招聘网站的完整兼容性验收**。

## 验证与开发

最新两轮正式包：0.6.60 通过40个 MV3/实际伴随服务场景；0.6.61 通过53个场景和61项相关单元，覆盖定位后新扫描、旧引用拒绝、真实PNG遮挡、固定星号、同屏批次、确认期变化和取消。测试数量只对应各轮实际范围；历史全量存在失败，不能把受影响范围通过描述成当前全量通过。

```powershell
npm run typecheck
npm run build
npx playwright install chromium
node scripts/test-visual-required-marker-layout.mjs
node scripts/test-visual-field-locator.mjs
```

`npm run check` 是全量入口，`npm run test:e2e` 是既有浏览器回归入口；完整范围和历史失败见验收记录。占用固定本机端口的服务检查需要串行运行，不要与日常伴随服务同时启动。测试只使用隔离浏览器，不能代替真实网页验收。

本地演示可运行 `npm run serve:example`，打开 [测试表单](http://127.0.0.1:4173/test-form.html)。[样例档案](examples/sample-profile.json) 均为虚构资料，不能用于真实投递。

相关文档：

- [活计划与下一步](PROJECT_PLAN.md)、[Agent 指南](docs/AGENT_NEXT_STEP.md)
- [验收记录](VERIFICATION.md)、[可同步检查摘要](docs/checkpoints/2026-10-16.json)
- [长表单定位开发契约](docs/VISUAL_FIELD_LOCATION.md)
- [控件契约](CONTROL_CONTRACTS.md)、[档案 Schema](src/profile/schema.ts)

`dist/`、`artifacts/`、`release/`、本机配置、密钥和原始个人资料不随源码同步。正式安装资源的本机冻结副本保留逐文件 SHA256 和前版回退索引；具体路径见验收记录。
