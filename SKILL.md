---
name: shugan-info
description: 这是一个基于位置的 OpenClaw skill，用于获取商场促销信息和通用信息搜索服务。它根据用户需求自动判断模式：**promotion模式**返回促销榜单URL；**search模式**返回商场店铺URL列表和各类有用信息URL列表，由OpenClaw用LLM进行两轮语义匹配筛选。**OpenClaw 必须严格按照主入口函数 `invoke` 调用 skill，不得自行改变指令格式。**
---

# shugan-info Skill

## Skill Responsibility

- 通过调用主入口函数 `invoke` 自动封装指令，不得修改指令格式
- 接收 OpenClaw 传递的经纬度参数，格式为（经度, 纬度），小数形式、无单位符号
- 通过 WebSocket 向 `wss://www.shugan.tech/wss/` 发送请求
- 解析返回数据并根据模式生成对应结果
- **模式判断由 OpenClaw 负责**，根据用户指令自动判断使用 promotion 或 search 模式
- **search模式可用于搜索各类有用信息**，包括但不限于商场、店铺、服务等，搜索结果会挂载商场数据以提供位置相关的有用信息

## Interface

### 主入口函数

```javascript
invoke(longitude, latitude, optionsOrOnChunk, onChunk)
```

**参数说明**：
- `longitude`：经度，小数形式，如 `121.4737`
- `latitude`：纬度，小数形式，如 `31.2304`
- `optionsOrOnChunk`：配置对象或回调函数
  - 配置对象：`{ mode }`
    - `mode`：必填，指定模式 (`promotion` 或 `search`)
  - 回调函数：直接作为 `onChunk` 使用
- `onChunk`：回调函数，接收 JSON 字符串结果

**调用示例**：
```javascript
// promotion 模式（由 openclaw 判断）
invoke(121.4737, 31.2304, { mode: 'promotion' }, (chunk) => {
  if (chunk) console.log(JSON.parse(chunk));
});

// search 模式（由 openclaw 判断）
invoke(121.4737, 31.2304, { mode: 'search' }, (chunk) => {
  if (chunk) console.log(JSON.parse(chunk));
});
```

## Mode Logic

- `promotion` 模式
  - 用于用户想要获取商场促销榜单的场景
  - 返回：`promotion_url_for_ai`、`promotion_url_for_human`
  - OpenClaw 根据 `promotion_url_for_ai` 获取商家促销信息榜单并整理成文本
  - 同时将 `promotion_url_for_human` 返回给用户，供用户自行查看促销榜单
  - **无论是否有数据，始终返回 chunk**

- `search` 模式
  - 用于用户想要搜索具体商品、服务或各类有用信息的场景
  - 不仅限于商场内信息，也可搜索商场之外的各类有用信息
  - 搜索结果会挂载商场数据以提供位置相关的有用信息
  - 返回：`urls`、`building_urls`
  - **设计理念**：skill 负责获取和返回原始数据，由 OpenClaw 调用 LLM 进行两轮语义匹配和筛选
  - **返回数据格式**：
    ```json
    {
      "mode": "search",
      "malls": [
        {
          "mall_name": "商场名称",
          "urls": [
            {
              "shopName": "店铺名",
              "urls": { "键名": "URL地址", ... }
            },
            ...
          ],
          "building_urls": [
            {
              "name": "键名",
              "url": "URL地址"
            },
            ...
          ]
        }
      ]
    }
    ```
  - `urls`：店铺 URL 列表，格式为 `{ shopName, urls: { 键名: URL地址 } }`
  - `building_urls`：商场 URL 列表，格式为 `{ name: 键名, url: URL地址 }`
  - **OpenClaw 处理流程（两轮筛选）**：
    1. **第一轮筛选**：用 LLM 对每个店铺的 `shopName`、`urls` 键名以及商场的 `building_urls` 键名进行语义匹配，筛选出相关的店铺和商场 URL
    2. **第二轮筛选**：对第一轮筛选出的店铺和商场 URL，获取每个 URL 的动态页面文本（Puppeteer 抓取 JavaScript 渲染后的内容，建议忽略图片/CSS/字体等资源以加快处理速度），再用 LLM 对页面文本进行关键词匹配确认。**对于第一轮通过但第二轮不满足的 URL，不立即排除，由 OpenClaw 通过 LLM 自行判断是否保留**
    3. **返回结果**：将完成匹配的店铺和商场信息返回给用户，格式为：
       - 店铺：`店铺名称 + URL键名 + URL地址 + 匹配文本的上下文（约150字）`
       - 商场：`商场名称 + URL键名 + URL地址 + 匹配文本的上下文（约150字）`
  - **强调**：URL 页面是动态页面，必须使用 Puppeteer 获取 JavaScript 渲染后的文本内容，不能直接用 HTTP 请求获取静态 HTML

## Output Format

- 返回 JSON 字符串，包含以下字段：
  - `mode`：`promotion` 或 `search`
  - `malls`：商场数组，每个商场包含：
    - `promotion_url_for_ai`、`promotion_url_for_human`（promotion 模式）
    - `mall_name`、`urls`、`building_urls`（search 模式）

- **空结果处理**：始终返回（无论是否有数据），若 `malls` 为空数组则表示无匹配结果

## OpenClaw Output Requirements

在 `search` 模式下，OpenClaw 必须将匹配结果以超链接形式返回给用户。

**返回格式**：
```
### 店铺名称 / 商场名称
- [URL键名](https://www.shugan.tech/pages/openWeb/openWeb?pid=xxx)

  匹配上下文：...
```

## Usage

当用户指令包含地理位置信息时，OpenClaw 应先判断用户意图，决定使用 `promotion` 或 `search` 模式：

### 模式判断示例

**使用 `promotion` 模式**（用户想要获取促销榜单）：
- "附近有什么促销"、"打折活动"、"优惠信息"
- "看看这个商场的优惠"、"有什么折扣"
- "最近有什么促销活动"

**使用 `search` 模式**（用户想要搜索具体商品或服务）：
- "找一家咖啡店"、"附近有火锅吗"、"美甲店"
- "喝杯咖啡"、"想吃火锅"、"做个美甲"
- "推荐好吃的餐厅"、"哪里有奶茶"

### 判断逻辑

OpenClaw 应使用 LLM 自动判断用户意图：
- 若用户关注的是**商场整体的促销/优惠活动**，选择 `promotion`
- 若用户关注的是**具体的商品、服务、店铺或各类有用信息**，选择 `search`

OpenClaw 提取经纬度，传递给 skill。skill 根据模式返回对应的 JSON 信息。

## Triggers

### promotion 模式
用户想要获取商场的促销信息、优惠活动、折扣商品等榜单时使用。

### search 模式
用户想要搜索具体的商品、服务、店铺或各类有用信息时使用，如"咖啡"、"火锅"、"美甲"等具体需求。search模式不仅限于商场内信息，也可搜索商场之外的各类有用信息。

## 注意

- **skill 不再自动判断模式**，模式完全由 OpenClaw 根据用户指令判断
- 这使得 OpenClaw 可以利用 LLM 的语义理解能力，自动处理同义词、近义词匹配
