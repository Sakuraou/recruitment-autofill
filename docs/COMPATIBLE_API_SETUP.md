# 连接兼容模型 API

当前扩展已支持由本机服务调用 OpenAI 兼容 Chat Completions 接口。模型分析字段含义，答案从本地档案读取，教育、项目、实习、奖励和专业论著的当前记录流程负责新增、填写、重扫及保存核验。局部截图需另行开启许可并配置兼容图像模型，只覆盖有限普通字段；尚未开放任意陌生按钮探索。

## 最快配置方法

在项目目录 `E:\job\recruitment-autofill` 打开终端：

```powershell
npm run semantic:setup
npm run semantic:serve
```

向导会询问服务地址、模型名和 API Key。密钥输入不显示，保存到被 Git 忽略的 `artifacts/semantic-model.local.json`。模型名请使用供应商控制台支持 JSON 输出的模型；本项目不替你选择或购买模型。

DeepSeek 地址可以选向导预设。通义千问及其他兼容服务使用供应商控制台给出的 Base URL，包含所需的地区和路径。模型支持 JSON Schema 时可以选严格格式；否则先用 JSON Object。不同模型的结构化输出支持范围以供应商说明为准。

服务启动后，在扩展「我的档案 → AI 识别连接」导入 `artifacts/semantic-connection.local.json`。这个文件只有本机配对令牌，不含 API Key。回到招聘网页后点击「AI 识别并填写本页」，或使用教育／项目／实习／奖励／专业论著连续填写入口。

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

v0.6.38 提供「启动 Agent 连续填写」及本人弱标量确认，完整发布回归通过。升级后重启本机服务，再使用Agent。兼容接口启动的本机服务同时提供下一步决策：观察本页可执行任务，推进普通字段、教育、项目、实习、奖励、专业论著和校内职务，执行后重新观察；模型不能跳过待办来宣称完成。运行期间保持弹窗打开；原单栏连续入口仍可在关闭弹窗后继续。步骤与限制见 [Agent 计划](AGENT_NEXT_STEP.md)。奖励当前使用已核验本地字段与明确原生干部题；专业论著已支持全部记录和明确原生存在性题；校内职务已支持全部记录和明确原生存在性题；v0.6.38增加可核验空组合框的有界选项观察，重扫后由模型判含义、本地读取答案；升级必须重启本机服务，否则旧下一步协议不认识新观察任务。截图回退、未知按钮探索及奖励/论文/职务陌生字段模型绑定仍待接入。

接口依据：[DeepSeek JSON 输出](https://api-docs.deepseek.com/guides/json_mode/)、[通义兼容 Chat API](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)、[通义结构化输出](https://help.aliyun.com/zh/model-studio/qwen-structured-output)。

## 验证范围

兼容提供方、配置及 HTTP 边界使用虚构密钥、虚构模型和本机上游测试；实际 MV3 验证了兼容 HTTP 调用、陌生字段填写、动态重扫、缓存、手改和取消。没有读取你的密钥，也没有调用真实付费模型。具体结果见 `VERIFICATION.md`。

## 局部截图识别（v0.6.40）

v0.6.43起，同一个图像许可也用于“启动 Agent 连续填写”：文字未解释的普通空字段会触发一次最多3项图片回退，核验后从档案读取答案自动填入，随后重新观察待办。没有图像许可时仍只走文字/规则；独立截图按钮仍只提供需核对候选。图片回退不借用重复经历编辑器，整次Agent共用12步预算，不循环请求图片。停止、修改资料/连接或撤销图像许可会取消等待；已有内容继续保留。

v0.6.42起，在下方启用截图前可点击“检查本机视觉接口”。检查只查询本机配对服务，不向供应商发请求、不给模型发测试图片。支持表示本机已配置图片请求接口；云模型是否接受图片仍由实际识别结果核验。明确没有接口时暂不能启用；旧服务不声明能力时显示尚未确认，不破坏原有文字连接。更换配对或关闭连接会取消正在进行的检查，旧结果不能恢复。

本机配置必须选择支持 image_url 多模态输入的 OpenAI 兼容模型。普通文字模型或原 Responses 配置暂不能用于此入口。重启本机服务后，在“AI 识别连接”先勾选字段语义许可并导入配对文件；已有旧连接缺许可时需要重新确认导入。再单独勾选局部图像许可，点击“启用局部截图识别”。两个许可默认关闭，可分别撤销。

在招聘页保持扩展弹窗打开，先“扫描页面”，再“局部截图识别未知字段”。每次最多观察3个规则未知的空字段，当前只接受身份明确、标签无遮挡的普通单标签输入。原截图在本机遮挡，只发送允许的标签像素与简短语义；模型仅返回字段路径，候选值从本地档案读取。结果作为需核对候选展示，不自动写入或提交。无法证明图像范围、缺资料、自定义复杂控件等仍保留待办。

导航、DOM节点替换、用户输入、档案或许可修改、关闭弹窗会取消本次识别；迟到结果不能转写新页面。验证码、上传和最终投递由本人完成。自动化使用虚构上游模型验证，真实云模型质量与登录招聘站点尚未验收。

