/**
 * 树感信息技能 (shugan-info)
 *
 * 通过 WebSocket 连接获取指定GPS位置周边的商铺和建筑信息。
 * 支持两种模式：
 * - promotion 模式：返回商铺推广信息 URL
 * - search 模式：返回商铺详细信息、URL列表和建筑 URL 列表
 *
 * @author Jungle You
 */

const https = require("https");
const WebSocket = require("ws");
const { randomUUID } = require("crypto");

// WebSocket 服务地址
const WS_URL = "wss://www.shugan.tech/wss/";

/**
 * 构造感知指令
 *
 * @param longitude 经度
 * @param latitude 纬度
 * @param mode 模式 ('search' 或 'promotion')
 * @returns JSON 字符串格式的指令
 */
function wrapInstruction(longitude, latitude, mode) {
  return JSON.stringify({
    command: 'sense',
    areaType: 1,
    gps: { lng: longitude, lat: latitude },
    senseRange: 2000,
    uuid: randomUUID(),
    targetName: 'WEB',
    targetNamespace: 'FACILITY',
    matchKeyword: '',
    clientPort: 0
  });
}

/**
 * 创建 WebSocket 连接
 *
 * @returns WebSocket 实例
 */
function createWebSocket() {
  return new WebSocket(WS_URL, {
    handshakeTimeout: 10000,
    maxPayload: 10 * 1024 * 1024
  });
}

/**
 * 获取 URL 内容
 *
 * @param url 目标 URL
 * @returns URL 内容（字符串）
 */
function fetchUrlContent(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 30000 }, (res) => {
      let body = "";
      res.setEncoding("utf8");

      res.on("data", (chunk) => {
        body += chunk;
      });

      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
        } else {
          reject(new Error(`HTTP ${res.statusCode} ${res.statusMessage}`));
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("Request timeout"));
    });
  });
}

/**
 * 构建结果对象
 *
 * @param uuid 建筑 UUID
 * @param mode 模式
 * @returns 结果对象
 */
function buildResultObject(uuid, mode) {
  if (mode === 'search') {
    return {
      mall_name: '',
      urls: [],
      building_urls: []
    };
  }

  return {
    promotion_url_for_ai: `https://www.shugan.tech/building/queryPromotion/${uuid}/`,
    promotion_url_for_human: `https://www.shugan.tech/building/?bid=${uuid}#/pages/AiPoster/AiPoster`
  };
}

/**
 * 获取商场所有店铺的 URL 列表（search 模式专用）
 *
 * 返回原始数据，由 OpenClaw 用 LLM 进行语义匹配
 *
 * @param obj 店铺数据对象
 * @returns 店铺 URL 列表
 */
async function getShopUrlsForSearch(obj) {
  if (!obj.shops || typeof obj.shops !== 'object') {
    return [];
  }

  const results = [];
  for (const [shopId, shopData] of Object.entries(obj.shops)) {
    if (shopData && typeof shopData === 'object' && shopData.url && typeof shopData.url === 'object') {
      const urlEntries = Object.entries(shopData.url).filter(([_, url]) => typeof url === 'string');
      if (urlEntries.length > 0) {
        results.push({
          shopName: shopData.name || 'Unknown Shop',
          urls: Object.fromEntries(urlEntries)
        });
      }
    }
  }
  return results;
}

// 无数据超时时间（毫秒）
const NO_DATA_TIMEOUT_MS = 10000;

/**
 * 发送感知指令并处理响应
 *
 * @param longitude 经度
 * @param latitude 纬度
 * @param mode 模式 ('search' 或 'promotion')
 * @param onChunk 数据块回调函数
 * @returns Promise，解析为完成结果
 */
async function sendInstruction(longitude, latitude, mode, onChunk) {
  const payload = wrapInstruction(longitude, latitude, mode);
  const ws = createWebSocket();

  return new Promise((resolve, reject) => {
    let closed = false;
    let idleTimer = null;
    let resolved = false;
    let pendingCount = 0;
    let wsClosed = false;
    const processedUuids = new Set();
    const allResults = [];

    /**
     * 重置空闲计时器
     *
     * 如果在规定时间内没有收到数据，关闭 WebSocket 连接
     */
    const resetIdleTimer = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      idleTimer = setTimeout(() => {
        if (!closed && ws.readyState === WebSocket.OPEN) {
          ws.close(1000, "idle timeout");
        }
      }, NO_DATA_TIMEOUT_MS);
    };

    /**
     * 清理资源
     */
    const cleanup = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    };

    /**
     * 安全解析 Promise
     *
     * 确保只解析一次
     *
     * @param val 解析值
     */
    const safeResolve = (val) => {
      if (!resolved) {
        resolved = true;
        resolve(val);
      }
    };

    let callbackInvoked = false;
    const invokeCallback = (data) => {
      if (!callbackInvoked && typeof onChunk === "function") {
        callbackInvoked = true;
        onChunk(data);
      }
    };

    /**
     * 尝试完成处理
     *
     * 当所有请求完成且 WebSocket 关闭时，返回最终结果
     */
    const tryFinish = () => {
      if (pendingCount === 0 && wsClosed && !resolved) {
        cleanup();
        invokeCallback(JSON.stringify({ mode, malls: allResults }));
        safeResolve({ code: 1000, reason: 'completed' });
      }
    };

    /**
     * 处理单个数据项
     *
     * @param item 数据项
     */
    const processItem = async (item) => {
      if (!item?.parameters?.url) return;
      const url = item.parameters.url;

      // 只对以 https://www.shugan.tech/building/?bid= 开头的url提取uuid
      const prefix = 'https://www.shugan.tech/building/?bid=';
      if (!url.startsWith(prefix)) return;

      // 提取建筑 UUID
      const uuid = url.substring(prefix.length).split('&')[0];
      if (processedUuids.has(uuid)) return;
      processedUuids.add(uuid);

      const result = buildResultObject(uuid, mode);

      if (mode === 'search') {
        pendingCount++;
        const buildingInfoUrl = `https://www.shugan.tech/building/buildingInfo/${uuid}/`;
        const shopUrl = `https://www.shugan.tech/building/shopAndOffice/${uuid}/`;
        const buildingUrlsUrl = `https://www.shugan.tech/building/queryBuildingUrls/${uuid}/`;
        try {
          // 并行获取建筑信息、店铺信息和建筑 URL
          const [buildingData, shopData, buildingUrlsData] = await Promise.all([
            fetchUrlContent(buildingInfoUrl),
            fetchUrlContent(shopUrl),
            fetchUrlContent(buildingUrlsUrl)
          ]);
          const buildingJson = JSON.parse(buildingData);
          if (buildingJson?.name) {
            result.mall_name = buildingJson.name;
          }
          const shopJson = JSON.parse(shopData);
          result.urls = await getShopUrlsForSearch(shopJson);
          const buildingUrlsJson = JSON.parse(buildingUrlsData);
          // 移除不需要的字段
          result.building_urls = buildingUrlsJson.map(({ id, timestamp, uuid, ...rest }) => rest);
        } catch (e) {
          console.error('[shugan-info] fetch error:', e.message);
          pendingCount--;
          return;
        }
        pendingCount--;
        if (result.mall_name) {
          allResults.push(result);
        }
        tryFinish();
      } else {
        allResults.push(result);
      }
    };

    // WebSocket 连接打开
    ws.on("open", () => {
      ws.send(payload, (err) => {
        if (err) {
          cleanup();
          reject(err);
        } else {
          resetIdleTimer();
        }
      });
    });

    // 处理接收到的消息
    ws.on("message", async (data) => {
      resetIdleTimer();
      const text = data.toString();
      try {
        const json = JSON.parse(text);
        if (Array.isArray(json) && json.length > 0) {
          for (const item of json) {
            await processItem(item);
          }
        }
      } catch (e) {
        console.error('[shugan-info] parse error:', e.message);
      }
    });

    // WebSocket 错误处理
    ws.on("error", (error) => {
      cleanup();
      if (!closed) {
        closed = true;
        reject(error);
      }
    });

    // WebSocket 关闭处理
    ws.on("close", (code, reason) => {
      cleanup();
      wsClosed = true;
      if (!closed) {
        closed = true;
        invokeCallback(JSON.stringify({ mode, malls: allResults }));
        safeResolve({ code, reason: reason.toString() });
      }
    });
  });
}

/**
 * 处理用户指令
 *
 * @param longitude 经度
 * @param latitude 纬度
 * @param optionsOrOnChunk 选项对象或回调函数
 * @param onChunk 回调函数
 * @returns Promise
 */
async function handleUserInstruction(longitude, latitude, optionsOrOnChunk, onChunk) {
  let options = {};
  let callback = onChunk;

  // 处理参数兼容
  if (typeof optionsOrOnChunk === 'function') {
    callback = optionsOrOnChunk;
  } else if (typeof optionsOrOnChunk === 'object' && optionsOrOnChunk !== null) {
    options = optionsOrOnChunk;
  }

  // 验证模式参数
  if (!options.mode) {
    throw new Error("options.mode is required, must be 'promotion' or 'search'");
  }
  const mode = options.mode;
  return sendInstruction(longitude, latitude, mode, callback);
}

// 直接运行模式
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 2 && args.length !== 3) {
    console.log(args);
    console.log("Usage: node skill.js <longitude> <latitude> [mode]");
    process.exit(1);
  }
  const longitude = parseFloat(args[0]);
  const latitude = parseFloat(args[1]);
  const mode = args[2] || 'search';

  // 验证经纬度参数
  if (isNaN(longitude) || isNaN(latitude)) {
    console.log("Error: longitude and latitude must be valid numbers");
    process.exit(1);
  }

  // 验证模式参数
  if (mode !== 'promotion' && mode !== 'search') {
    console.log("Error: mode must be 'promotion' or 'search'");
    process.exit(1);
  }

  handleUserInstruction(longitude, latitude, { mode }, (chunk) => {
    process.stdout.write(chunk);
  }).catch((error) => {
    console.error("WebSocket error:", error.message || error);
    process.exit(1);
  });
}

// 导出模块接口
module.exports = {
  invoke: handleUserInstruction,
  handleUserInstruction,
  sendInstruction,
  wrapInstruction
};