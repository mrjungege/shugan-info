# shugan-info

这是一个基于位置的 OpenClaw skill，用于获取商场促销、优惠券和免费福利信息。

## 说明

- 触发关键词：`促销`、`优惠`、`折扣`、`打折`、`商场`、`免费`、`福利`、`薅羊毛`、`白嫖`、`免费领取`、`福利活动`、`羊毛`、`免费试用`、`免费体验`、`免费活动`、`免费福利`、`特价`、`优惠券`、`满减`、`限时优惠`、`活动`、`促销活动`、`折扣券`
- 通过 `SKILL.md` 定义触发条件，由 OpenClaw 自动调用
- 输入：经纬度（经度, 纬度），小数形式，无单位
- 输出：根据关键词类型区分 `promotion` 和 `free` 模式：
  - `promotion`：返回促销榜单 URL（`promotion_url_for_ai` / `promotion_url_for_human`），并将 `promotion_url_for_human` 直接返回给用户以供查看
  - `free`：返回 `filtered`

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
node skill.js 121.4737 31.2304
```

## 接口

- `handleUserInstruction(longitude, latitude, onChunk)`
- `handleUserInstruction(longitude, latitude, options, onChunk)`
  - `longitude`：经度，小数形式
  - `latitude`：纬度，小数形式
  - `options.mode`：可选，`promotion` 或 `free`，用于强制指定模式
  - `options.keywords`：可选，用户原始关键词字符串，用于自动推断模式
  - `onChunk(chunk)`：接收 skill 返回的 JSON 字符串，或在无结果时接收空字符串

## 实现概要

- 与 `wss://www.shugan.tech/wss/` 建立 WebSocket 连接
- 发送包含经纬度的指令 JSON
- 解析返回数据，提取 `bid` 并构造：
  - `promotion_url_for_ai`（仅 `promotion` 模式）
  - `promotion_url_for_human`（仅 `promotion` 模式）
  - `shop_and_office_url`（仅 `free` 模式）
- 5 秒无数据则自动关闭连接

## free 模式后续处理

- skill 内部获取所有店铺的网络数据 JSON
- 在每个店铺的 `url` 对象中只筛选键名包含“免费”、“福利”或“薅羊毛”的值，该值应为 URL 地址
- 整理成包含 `name` 和 `filtered` 的数组返回给 OpenClaw
- **OpenClaw 使用 Puppeteer 获取每个筛选出的 URL 的动态页面文本**，处理 JavaScript 渲染的内容
- 整理免费福利信息并返回给用户
