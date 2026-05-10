# shugan-info

这是一个基于位置的 OpenClaw skill，用于获取商场促销信息和搜索服务。

## 说明

- 通过 `SKILL.md` 定义接口规范，由 OpenClaw 自动调用
- 输入：经纬度（经度, 纬度），小数形式，无单位
- 输出：根据模式区分 `promotion` 和 `search` 两种模式：
  - `promotion`：返回促销榜单 URL（`promotion_url_for_ai` / `promotion_url_for_human`），并将 `promotion_url_for_human` 直接返回给用户以供查看
  - `search`：返回商场名称、店铺列表及URL，由OpenClaw执行两轮筛选：一、用LLM对shopName和urls键名语义匹配；二、用Puppeteer获取URL动态页面文本，再用LLM对页面文本匹配。返回匹配结果（店铺名+键名+URL+上下文）。

## 结构

- `skill.js`：主入口和 WebSocket 调用实现
- `package.json`：项目元数据和依赖
- `SKILL.md`：OpenClaw skill 配置

## 安装

```bash
npm install
```

## 本地测试

```bash
node skill.js 121.4737 31.2304 promotion
node skill.js 121.4737 31.2304 search
```

## 接口

- `invoke(longitude, latitude, optionsOrOnChunk, onChunk)` - 主入口函数
- `handleUserInstruction(longitude, latitude, options, onChunk)`
  - `longitude`：经度，小数形式
  - `latitude`：纬度，小数形式
  - `options.mode`：必填，`promotion` 或 `search`
  - `onChunk(chunk)`：接收 skill 返回的 JSON 字符串

## 返回格式

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
      ]
    }
  ]
}
```

promotion 模式下每个商场返回 `promotion_url_for_ai` 和 `promotion_url_for_human`。

## 实现概要

- 与 `wss://www.shugan.tech/wss/` 建立 WebSocket 连接
- 发送包含经纬度的指令 JSON
- 解析返回数据，提取 `bid` 并构造商场数据
- 10 秒无数据则自动关闭连接
- **一次性返回所有商场的合并数据**

## search 模式后续处理

- skill 返回多个商场的名称、店铺列表（`shopName`）及 URL 列表
- **OpenClaw 执行两轮筛选**：
  1. 第一轮：用 LLM 对 `shopName` 和 `urls` 键名进行语义匹配，筛选出相关店铺
  2. 第二轮：对筛选出的店铺，用 Puppeteer 获取每个 URL 的动态页面文本，再用 LLM 对页面文本进行关键词匹配确认
- **返回结果**：店铺名称 + URL键名 + URL地址 + 匹配文本的上下文（约150字）
- **强调**：URL 页面是动态页面，必须使用 Puppeteer 获取 JavaScript 渲染后的文本内容

## 模式判断

- **skill 不再自动判断模式**，模式完全由 OpenClaw 根据用户指令判断
- OpenClaw 应使用 LLM 自动判断用户意图，决定使用 `promotion` 或 `search` 模式：

**使用 `promotion` 模式**（用户想要获取促销榜单）：
- "附近有什么促销"、"打折活动"、"优惠信息"
- "看看这个商场的优惠"、"有什么折扣"

**使用 `search` 模式**（用户想要搜索具体商品或服务）：
- "找一家咖啡店"、"附近有火锅吗"、"美甲店"
- "喝杯咖啡"、"想吃火锅"、"做个美甲"

## 注意

- **skill 不再自动判断模式**，模式完全由 OpenClaw 根据用户指令判断
- 这使得 OpenClaw 可以利用 LLM 的语义理解能力，自动处理同义词、近义词匹配
