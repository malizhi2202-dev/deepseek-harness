---
description: "Tuitui（推推）IM 桥接插件：用聊天消息驱动 DeepSeek Harness 的 agent 会话。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tuitui

[English](README.md) | 中文

## 概述

`dsh-tuitui` 把一个 Tuitui（推推）机器人接入 DeepSeek Harness 的 agent 会话。收到的聊天消息（`single_chat`、`group_chat` 和团队帖子）会变成 `Agent.followup()` 的用户轮次；助手的文本回复通过 Tuitui 的 HTTP 发送接口流式回传。每个会话对应一个 Agent 会话，后续消息在同一会话里续聊，直到发送 `/new` 或 `/cd` 重置。`/tree` 命令会打开一张可原地更新的交互式文件树卡片，用来浏览、查看、搜索工作区文件，并（经确认后）重命名、删除和复制文件。

机器人凭据用于配置真实的 WebSocket + HTTP 传输；测试通过仅运行期存在的 `config.transport` 注入桩实现，而非真实连接。回复只累积 `assistant/message` 的 `text` 块（不含 `reasoning`），并在 `turn/end` 之后发回；工具调用与结果照常流经 Session，不会打断聊天回复。

## 目录

- [命令](#commands)
- [配置](#configuration)
- [装配](#composition)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="commands"></a>

## 命令

桥接插件会在消息到达 agent 之前拦截以斜杠开头的聊天文本：

| 命令 | 作用 |
|---|---|
| `/new` | 销毁当前会话，下一条消息开始新会话。 |
| `/cd <路径>` | 切换 agent 工作目录并重置会话。 |
| `/pwd` | 回复当前工作目录。 |
| `/tree [路径]` | 在给定（或当前）目录打开交互式文件树卡片。 |
| `/help` | 回复命令列表和当前目录。 |
| `/status` | 回复目录、会话 id 和忙碌状态。 |

未知的斜杠命令会作为普通文本交给 agent 处理。

<a id="configuration"></a>

## 配置

所有随部署变化的取值都是 `Config` 字段，可在 `cordis.yml` 中修改。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `appId` | —（必填） | Tuitui 应用 id。 |
| `appSecret` | —（必填） | Tuitui 应用密钥。 |
| `host` | —（必填） | Tuitui IM 服务器主机（连接地址）。 |
| `cwd` | 进程 cwd | 新会话的 agent 工作目录。 |
| `agentPreset` | 部署默认 | agent 预设 id；为空时使用默认预设。 |
| `permissionPreset` | 部署默认 | 权限预设 id；为空时使用默认权限预设。 |
| `provider` / `model` | 部署默认 | 可选的显式路由，`provider` 为已注册的 provider id，`model` 为 model id。两者要么都填，要么都不填：都不填时使用部署默认；任一 id 无法解析时会在对话中报错，并列出已注册的 provider 或该 provider 已配置的 model。每条消息都会重新解析路由，因此保存的变更能到达已记录旧路由的聊天，而无需重启会话。 |
| `allowFrom` | `[]` | 允许私聊使用机器人的账号；`"*"` 表示全部允许。 |
| `groupAllowFrom` | `[]` | 允许使用的群/团队 id；`"*"` 表示全部允许。 |
| `requireMention` | `true` | 在群和频道中要求 @提及。 |
| `emojiReaction` | `true` | 对收到的消息做表情回应。 |
| `reactionEmoji` | `收到` | 回应表情文本。 |
| `showThinking` | `true` | 在首个回复片段前发送“正在思考”占位。 |
| `dataDir` | `~/.dsh-tuitui` | 持久化各会话 cwd 与文件树卡片的目录。 |
| `treeEnabled` | `true` | 启用 `/tree` 工作台。 |
| `treePageSize` | `5` | 每页文件树条目数。 |
| `treeShowHidden` | `false` | 在列表中显示隐藏文件。 |
| `treeIgnore` | 内置默认 | 在列表中额外隐藏的文件名。 |
| `treeAllowWrite` | `true` | 允许重命名/删除/复制（始终需要确认）。 |
| `treePersist` | `true` | 跨重启持久化文件树卡片绑定。 |

缺少 `appId`/`appSecret`/`host` 时插件仍会加载并服务其设置命名空间，但桥保持停止，直到三者都设置好（由 GUI 卡片收集）。`cwd` 不是目录时仍在加载时报错失败。

上述每个字段也可以在 Web GUI 中编辑：**设置 → 插件 → 插件配置** 中会列出一张绑定到实时 `tuitui` 设置命名空间的 Tuitui 卡片，无需重新部署即可重新配置运行中的机器人。`appSecret` 是 `role('secret')` 字段——由 Host 在 `describe` 时脱敏，并通过从不读回的 settings path-op 写入，因此卡片只显示是否已配置。

<a id="composition"></a>

## 装配

该插件是函数插件（`name` / `inject` / `Config` / `apply`），注入 `agents`、`agentDefaultModel`、`agentPresets`、`llm` 和 `permissionPresets`。它不会被加入任何默认 profile；请在 Agent、预设和权限预设挂载之后，再把它写到 `cordis.yml`：

```yaml
- name: '@deepseek-ai/dsh-tuitui'
  config:
    appId: '…'
    appSecret: '…'
    allowFrom: ['*']
    groupAllowFrom: ['*']
```

仅运行期存在的 `transport` 字段不属于 `Config` schema；它让装配测试能用桩替换真实的 WebSocket + HTTP 客户端。

<a id="model-experience"></a>

## 模型体验

### 聊天轮次

#### 模型看到的内容

每条收到的聊天消息会变成一个用户轮次，内容为 `[{ type: "text", text: <消息> }]`，且 `source.kind: "tuitui"`，携带 `chatId`、`chatType`、`senderId` 和 `senderName`。非文本媒体（图片、语音、视频、文件）会替换为描述性占位文本加媒体 URL，模型不会收到二进制内容。

#### Token 影响

聊天文本和 `tuitui` 来源元数据会被记入 Session；桥接器不添加任何额外框架或系统提示文本。多轮对话在同一 Session 上累积，因此每次追问都会按预设的压缩策略重新携带历史。

#### KV Cache 影响

桥接器本身不引入任何影响：系统提示、工具 schema 和模型前缀都来自复用的预设。桥接器只向 Session 追加每轮的用户内容与 `tuitui` 来源元数据，因此前缀行为与同一预设下的普通 Web 会话一致。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 会话存于内存：DSH 重启会丢失对话连续性（各会话 cwd 与文件树卡片会持久化，但 Session 不会）。通过会话持久化恢复的续聊暂未实现。
- 聊天 Session 永不弹出审批请求，因为 IM 聊天没有交互式应答方：沙箱提权会被确定性地拒绝，模型在无提权的情况下继续。若部署方希望该聊天拥有更宽的权限，可把 `permissionPreset` 设为携带该沙箱模式的预设。
- 未桥接 `ask_user_question`：若 Session 所用的 preset 挂载了 `tool-ask-user`，该轮会一直等待一个聊天参与者无法给出的回答，聊天会停留在「处理中」。把提问桥接到聊天回复暂未实现。
- 未移植 AI 兜底意图解析：不匹配任何确定性规则的文件树文本只会显示提示视图，不会请求模型。
- Tuitui API 不会向 `teams_` 频道场景投递交互式卡片，因此 `/tree` 在该场景会回复发送失败提示。
- 参考桥接器的单次 `/status` 历史轮数和 AI `/tree` 文本路由未被复现。

线路解析（`parseEvent`、`parseInteractiveCallback`、`splitMessage`、`guessChatType`）与文件树工作台由 `tui_coding_agent_bridge` 移植而来；上文所列差异是仅有的行为差异。

**运行期不变量：** 不发布 companion：该桥不拥有除 Loader 装配测试与传输接缝解码规则之外的任何可独立观测的包内关系，而这些已由单元测试覆盖。