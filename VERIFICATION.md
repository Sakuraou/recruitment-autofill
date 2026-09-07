# MVP 1 验收记录

验证日期：2026-09-07，版本 0.1.1。源码位于本仓库，安装包由 `npm run build` 生成到 `dist/`。

## 已执行

| 项目 | 结果 |
| --- | --- |
| ESLint | 通过，0 warnings |
| TypeScript strict | 通过 |
| Vitest | 9 个测试文件，162 项通过 |
| Vite + esbuild 生产构建 | 通过，Manifest 入口齐全 |
| MV3 实际安装 | Chrome for Testing 153.0.8010.12 成功加载原始 dist，Service Worker 启动 |
| 本地存储 | Options 中导入、保存、刷新恢复、JSON 实际下载均通过 |
| 字段扫描 | 43 个原生字段，28 高置信度、1 待确认、2 缺失、12 受保护 |
| 批量填写 | 28 / 28 项成功，无跳过和错误 |
| 低置信度 | 78% 的专业类别保留空值，勾选确认后填入 |
| 保护字段 | 验证码、密码、协议、已有邮箱、已有性别保持不变 |
| 提交 | 整个填写与确认过程提交事件计数为 0 |
| 动态表单 | 新增民族后重开弹窗、扫描、填写成功，旧值保留 |
| 完整档案隔离 | Content Script 调用 storage.local.get 被拒绝 |
| 测试页面与扩展外连 | 测试捕获的外部 HTTP 请求 0，页面脚本错误 0 |
| React 受控控件 | input / textarea / select 的 React state 更新，未触发提交 |
| 移动结构模拟页 | 19 个原生/自定义控件，6 项高置信度填写全部成功；下拉事件更新页面选项状态 |
| 移动保护检查 | 真实已有值、英文名、紧急联系人、隐藏项目、证件类型、生日和性别保持不变；提交计数 0 |

## 回归覆盖

包含中文别名、label/ARIA/placeholder/父文本/相邻文字/表格/章节、学历与学位区别、本科硕士顺序颠倒、多条经历归属、缺失事实、下拉框重复和禁用选项、开放题字数与原文版本、姓名拼音等复合标签、紧急联系人归属、旧扫描、节点替换、动态选项、已有值保护、日期精度、消息来源限制、档案格式校验、Profile 修改后拒绝旧计划、Debug 脱敏。

v0.1.1 增加 20 项移动相关回归：精确站点和模板范围内识别已知默认提示语、`dt` 及章节归属、下拉选项事件、危险证件联动保护、数值选项保留小数点和百分比、多段教育研究方向消歧、500 汉字语义限制和网站保存校验的字段上限。

## 浏览器测试边界

端到端脚本 `scripts/test-extension.mjs` 运行在临时浏览器中，加载真实构建产物，没有修改生产 manifest 或增加 host 权限。通过 Chromium 的 `Extensions.triggerAction` 触发真实工具栏动作并授予 activeTab；无头模式无法将工具栏气泡直接作为 Playwright 页面访问，因此使用同一生产 `popup.html` 的非活动扩展标签页执行界面点击。它验证了真实扩展 API、权限、消息和页面交互，但不等于人工检查工具栏气泡的原生窗口尺寸。

内置浏览器额外检查了 Options 界面布局与教育经历入口。截图和机器报告保存在 `artifacts/`，全部只包含虚构测试资料。

Chrome for Testing 的版本仅代表测试环境；生产 manifest 使用 Chrome / Edge 共用的 MV3 API，最低 Chromium 114。尚未分别在用户日常 Chrome 和 Edge 配置安装，也未验证任何招聘站登录后的自定义控件。不能据此承诺特定招聘网站覆盖率或填写耗时已经降低到 5–15 分钟。

移动回归页面由本项目独立编写，复现官网公开 JavaScript 中的 `value` 提示语、`dl/dt/dd` 结构和选项事件。测试在临时浏览器内拦截一个精确的移动 URL 并返回本地虚构页面，未访问用户会话或真实申请。此验证覆盖已复现的失败机制，不等于真实账号页面全量验收。截图为 `artifacts/mobile-popup.png`、`artifacts/mobile-form.png`。

## 复现

```powershell
npm ci
npm run check
npx playwright install chromium
npm run test:e2e
```

先停止占用 4173 的测试服务器。机器报告为 `artifacts/extension-e2e.json`；截图为 `options.png`、`popup.png`、`filled-form.png`。测试使用虚构样例且没有操作真实申请。

后续 LLM 语义匹配和开放题生成按用户要求暂不进入 MVP 1，待真实网页使用反馈后继续。
