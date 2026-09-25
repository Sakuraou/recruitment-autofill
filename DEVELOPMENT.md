# 开发记录

当前开发基线为 v0.5.0。本文保留早期 MVP 的设计背景；正在执行的里程碑、逐步提示词、验收标准和调整规则以 [PROJECT_PLAN.md](PROJECT_PLAN.md) 为准，已验证能力以 [VERIFICATION.md](VERIFICATION.md) 为准。

目标：本地档案 → 当前页面扫描 → 中文规则匹配 → 预览 → 高置信度填写／逐项确认。

## 第一阶段任务

1. 检查 Node、npm 和工作区，在独立目录创建项目。
2. 定义带版本号的 UserProfile、FieldDescriptor、MatchResult，并验证导入数据。
3. 构建 Manifest V3：两个 React 页面、按需注入的独立 Content Script、Service Worker。
4. 执行 lint、typecheck、tests 和 build，检查安装包入口齐全。
5. 下一阶段实现 Scanner、Alias/Matcher、Autofill，逐阶段加入行为测试。
6. 完成 Popup、Options、测试页与浏览器验收。

以上阶段已完成。阶段骨架通过 3 项 Schema 测试；Scanner 阶段通过 7 项扫描测试；执行器与消息验证通过；v0.1.1 共 162 项单元/集成测试，并完成真实构建产物的 Chromium 端到端验收，含移动结构模拟回归，详情见 VERIFICATION.md。

## 数据与权限边界

- `src/profile/schema.ts` 同时提供 TypeScript 类型和 Zod 运行时校验，拒绝未知字段与不支持的版本。
- `education[].level` 为学历；`education[].degree` 为学位。不推导不存在的成绩、日期或学历类别。
- 经历具有稳定 id；列表顺序不表示最高学历。多个同阶段经历缺少绑定时提示确认。
- `TextVariants.byLimit` 是字数 → 用户维护的答案，如 50、100、150、200、300、500，可扩展。
- MatchResult 的 confidence 表示匹配可靠程度，不替代验证码、已有值和旧扫描等执行门禁。
- Popup / Options 可读取完整档案；Content Script 只扫描字段并接收本次填写指令。
- MVP 1 不包含网络请求、API Key、LLM SDK 或云端数据库。

## 历史后续设想

MVP 2：经用户主动触发、数据最小化的语义匹配，返回经过 JSON Schema 校验的档案路径；所有 AI 候选人工确认。

MVP 3：仅依据获准的真实经历生成开放题草稿；提供依据、字数限制和明确预览，缺失事实保持为空。

这些早期设想已由当前活计划取代。复杂控件、重复记录流程、受控大模型和局部多模态能力将按项目计划逐阶段实现，每一阶段都保留现有安全边界和回归测试。
