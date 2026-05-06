---
name: shugan-info
description: 这是一个基于位置的 OpenClaw skill，用于获取商场促销、优惠券和免费福利信息。它根据用户关键词区分促销类和免费类请求，触发不同处理逻辑。**OpenClaw 必须严格按照主入口函数 `invoke` 调用 skill，不得自行改变指令格式。**
---

# shugan-info Skill

## Skill Responsibility

- 通过调用主入口函数 `invoke` 自动封装指令，不得修改指令格式
- 接收 OpenClaw 传递的经纬度参数，格式为（经度, 纬度），小数形式、无单位符号
- 通过 WebSocket 向 `wss://www.shugan.tech/wss/` 发送请求
- 解析返回数据并根据模式生成对应结果

## Mode Logic

- `promotion` 模式
  - 关键词：促销、优惠、折扣、打折、商场、特价、优惠券、满减、限时优惠、折扣券
  - 输出：`promotion_url_for_ai`、`promotion_url_for_human`
  - OpenClaw 根据 `promotion_url_for_ai` 获取商家促销信息榜单并整理成文本
  - 同时将 `promotion_url_for_human` 返回给用户，供用户自行查看促销榜单

- `free` 模式
  - 关键词：免费、福利、薅羊毛、白嫖、免费领取、福利活动、羊毛、免费试用、免费体验、免费活动、免费福利
  - 输出：`filtered`
  - skill 获取所有店铺的网络数据 JSON，在每个店铺的 `url` 对象中筛选键名包含关键词的值，该值应为 URL 地址；整理成包含 `name` 和 `filtered` 的数组返回给 OpenClaw；**OpenClaw 再通过 Puppeteer 获取动态页面文本与 URL 地址一起整理给用户**

- `activity` 模式
  - 关键词：周年庆、店庆、节日活动、店庆活动、周年庆典、品牌活动、庆典、春节、元宵节、端午节、中秋节、重阳节、情人节、母亲节、父亲节、儿童节、圣诞节、感恩节、万圣节、元旦、双十一、双十二、618、黑色星期五、活动、商场活动
  - 输出：`filtered`
  - 逻辑与 `free` 模式类似，skill 同样获取所有店铺的网络数据 JSON，在每个店铺的 `url` 对象中筛选键名包含活动关键词的值并返回；**OpenClaw 再通过 Puppeteer 获取动态页面文本与 URL 地址一起整理给用户**

## Output Format

- 返回 JSON 字符串，包含以下字段：
  - `mode`：`promotion`、`free` 或 `activity`
  - `promotion_url_for_ai`：仅 `promotion` 模式返回
  - `promotion_url_for_human`：仅 `promotion` 模式返回
  - `filtered`：仅 `free` 和 `activity` 模式返回，筛选出的店铺数组，每个元素包含 `name` 和 `filtered` 对象

- 若未提取到有效信息，则返回空字符串

## Usage

当用户指令包含地理位置信息和本 skill 触发词时，OpenClaw 应先提取地理位置，经纬度传递给 skill。skill 根据关键词类型决定模式并返回对应的 JSON 信息。

## Triggers
triggers:
  - 促销
  - 优惠
  - 折扣
  - 打折
  - 商场
  - 免费
  - 福利
  - 薅羊毛
  - 白嫖
  - 免费领取
  - 福利活动
  - 羊毛
  - 免费试用
  - 免费体验
  - 免费活动
  - 免费福利
  - 特价
  - 优惠券
  - 满减
  - 限时优惠
  - 活动
  - 折扣券
  - 商场活动
  - 周年庆
  - 店庆
  - 节日活动
  - 店庆活动
  - 周年庆典
  - 品牌活动
  - 庆典
  - 春节
  - 元宵节
  - 端午节
  - 中秋节
  - 重阳节
  - 情人节
  - 母亲节
  - 父亲节
  - 儿童节
  - 圣诞节
  - 感恩节
  - 万圣节
  - 元旦
  - 双十一
  - 双十二
  - 618
  - 黑色星期五
  - 薅羊毛
