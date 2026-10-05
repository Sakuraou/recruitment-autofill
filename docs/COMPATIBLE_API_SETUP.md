# 连接兼容模型 API

当前扩展已支持由本机服务调用 OpenAI 兼容 Chat Completions 接口。模型分析字段含义，答案从本地档案读取，现有教育、项目和实习连续填写流程负责新增、填写、重扫及保存核验。尚未开放截图分析或模型自主探索陌生按钮。

## 最快配置方法

在项目目录 `E:\job\recruitment-autofill` 打开终端：

```powershell
npm run semantic:setup
npm run semantic:serve
```

向导会询问服务地址、模型名和 API Key。密钥输入不显示，保存到被 Git 忽略的 `artifacts/semantic-model.local.json`。模型名请使用供应商控制台支持 JSON 输出的模型；本项目不替你选择或购买模型。

DeepSeek 地址可以选向导预设。通义千问及其他兼容服务使用供应商控制台给出的 Base URL，包含所需的地区和路径。模型支持 JSON Schema 时可以选严格格式；否则先用 JSON Object。不同模型的结构化输出支持范围以供应商说明为准。

服务启动后，在扩展「我的档案 → AI 识别连接」导入 `artifacts/semantic-connection.local.json`。这个文件只有本机配对令牌，不含 API Key。回到招聘网页后点击「AI 识别并填写本页」，或使用教育／项目／实习连续填写入口。

服务提示“模型已配置”表示本机配置通过检查，并不表示密钥权限、额度或云端模型质量已经验证。首次填写仍会核验实际返回结果；验证码、上传和最终投递由你处理。

## 文件或环境变量配置

也可以把 `examples/semantic-model.example.json` 复制到 `artifacts/semantic-model.local.json`，填写模型名和服务地址，并在当前 PowerShell 会话设置 `RA_MODEL_API_KEY`。该样例通过 `apiKeyEnv` 读取环境变量，不包含真实密钥。

如需要直接在本机 JSON 配置密钥，把 `apiKeyEnv` 替换为 `apiKey`；两者只能保留一个。不要把本机配置文件当作档案 JSON 导入扩展。

```json
{
  "provider": "openai-compatible",
  "baseUrl": "https://YOUR_API_HOST/v1",
  "model": "YOUR_MODEL_NAME",
  "apiKeyEnv": "RA_MODEL_API_KEY",
  "outputFormat": "json_object"
}
```

支持完整 `/chat/completions` 地址，服务不会重复拼接路径。允许本机 `http://127.0.0.1:端口/v1` 用于兼容本地模型，远端地址使用 HTTPS。网页或模型不能修改此地址。

需要禁用模型思考模式的兼容服务可以在配置中显式增加 `"enableThinking": false`；不配置时不会添加供应商专用参数。

自定义配置路径：

```powershell
npm run semantic:serve -- --config "E:\你的配置目录\模型.json"
```

纯环境变量方式使用 `RA_MODEL_PROVIDER=openai-compatible`、`RA_MODEL_BASE_URL`、`RA_MODEL_NAME`、`RA_MODEL_API_KEY`，可选 `RA_MODEL_OUTPUT_FORMAT=json_schema`、`RA_MODEL_ENABLE_THINKING=false`。旧的 `OPENAI_API_KEY` 与 `RA_OPENAI_MODEL` 配置仍走原 OpenAI Responses 接口；显式兼容配置错误时不会偷换为旧接口。

## 当前 Agent 能力及下一步

目前模型负责字段含义，扩展执行本地资料读取、动态观察和各条经历的事务流程。只有已核验的含义和答案能进入写入器；模型返回多余答案、脚本、工具调用、错误字段或不完整 JSON 时停止。

v0.6.35 提供「启动 Agent 连续填写」及本人弱标量确认，完整发布回归通过。升级后重启本机服务，再使用Agent。兼容接口启动的本机服务同时提供下一步决策：观察本页可执行任务，推进普通字段、教育、项目、实习和奖励，执行后重新观察；模型不能跳过待办来宣称完成。运行期间保持弹窗打开；原单栏连续入口仍可在关闭弹窗后继续。步骤与限制见 [Agent 计划](AGENT_NEXT_STEP.md)。奖励当前使用已核验本地字段与明确原生干部题；专业论著/校内职务、截图回退、未知按钮探索及奖励陌生字段模型绑定尚待接入。

接口依据：[DeepSeek JSON 输出](https://api-docs.deepseek.com/guides/json_mode/)、[通义兼容 Chat API](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)、[通义结构化输出](https://help.aliyun.com/zh/model-studio/qwen-structured-output)。

## 验证范围

兼容提供方、配置及 HTTP 边界使用虚构密钥、虚构模型和本机上游测试；实际 MV3 验证了兼容 HTTP 调用、陌生字段填写、动态重扫、缓存、手改和取消。没有读取你的密钥，也没有调用真实付费模型。具体结果见 `VERIFICATION.md`。
