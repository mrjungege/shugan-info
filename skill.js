const https = require("https");
const WebSocket = require("ws");
const { randomUUID } = require("crypto");

const WS_URL = "wss://www.shugan.tech/wss/";

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

function createWebSocket() {
  return new WebSocket(WS_URL, {
    handshakeTimeout: 10000,
    maxPayload: 10 * 1024 * 1024
  });
}

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

function buildResultObject(uuid, mode) {
  if (mode === 'search') {
    return {
      mall_name: null,
      urls: []
    };
  }

  return {
    promotion_url_for_ai: `https://www.shugan.tech/building/queryPromotion/${uuid}/`,
    promotion_url_for_human: `https://www.shugan.tech/building/?bid=${uuid}#/pages/AiPoster/AiPoster`
  };
}

/**
 * 获取商场所有店铺的URL列表（search模式专用）
 * 返回原始数据，由openclaw用LLM进行语义匹配
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

const NO_DATA_TIMEOUT_MS = 10000;

async function sendInstruction(longitude, latitude, mode, onChunk) {
  const payload = wrapInstruction(longitude, latitude, mode);
  const ws = createWebSocket();

  return new Promise((resolve, reject) => {
    let closed = false;
    let idleTimer = null;
    let resolved = false;
    let pendingCount = 0;
    const processedUuids = new Set();
    const allResults = [];

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

    const cleanup = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    };

    const safeResolve = (val) => {
      if (!resolved) {
        resolved = true;
        resolve(val);
      }
    };

    const processItem = async (item) => {
      if (!item?.parameters?.url) return;
      const url = item.parameters.url;
      const bidIndex = url.indexOf('bid=');
      if (bidIndex === -1) return;

      const uuid = url.substring(bidIndex + 4).split('&')[0];
      if (processedUuids.has(uuid)) return;
      processedUuids.add(uuid);

      const result = buildResultObject(uuid, mode);
      if (mode === 'search') {
        pendingCount++;
        const buildingInfoUrl = `https://www.shugan.tech/building/buildingInfo/${uuid}/`;
        const shopUrl = `https://www.shugan.tech/building/shopAndOffice/${uuid}/`;
        try {
          const [buildingData, shopData] = await Promise.all([
            fetchUrlContent(buildingInfoUrl),
            fetchUrlContent(shopUrl)
          ]);
          const buildingJson = JSON.parse(buildingData);
          if (buildingJson?.name) {
            result.mall_name = buildingJson.name;
          }
          const shopJson = JSON.parse(shopData);
          result.urls = await getShopUrlsForSearch(shopJson);
          allResults.push(result);
        } catch (e) {
          console.error('[shugan-info] fetch error:', e.message);
        } finally {
          pendingCount--;
          if (pendingCount === 0 && closed) {
            safeResolve({ code: 1000, reason: 'completed' });
          }
        }
      } else {
        allResults.push(result);
      }
    };

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

    ws.on("error", (error) => {
      cleanup();
      if (!closed) {
        closed = true;
        reject(error);
      }
    });

    ws.on("close", (code, reason) => {
      cleanup();
      if (!closed) {
        closed = true;
        const cleanupAndResolve = () => {
          if (typeof onChunk === "function") {
            onChunk(JSON.stringify({ mode, malls: allResults }));
          }
          safeResolve({ code, reason: reason.toString() });
        };
        if (pendingCount === 0) {
          cleanupAndResolve();
        } else {
          const maxWait = 300000;
          const startTime = Date.now();
          const checkInterval = setInterval(() => {
            if (pendingCount === 0 || Date.now() - startTime > maxWait) {
              clearInterval(checkInterval);
              cleanupAndResolve();
            }
          }, 5000);
        }
      }
    });
  });
}

async function handleUserInstruction(longitude, latitude, optionsOrOnChunk, onChunk) {
  let options = {};
  let callback = onChunk;

  if (typeof optionsOrOnChunk === 'function') {
    callback = optionsOrOnChunk;
  } else if (typeof optionsOrOnChunk === 'object' && optionsOrOnChunk !== null) {
    options = optionsOrOnChunk;
  }

  const mode = options.mode || 'search';
  return sendInstruction(longitude, latitude, mode, callback);
}

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
  if (isNaN(longitude) || isNaN(latitude)) {
    console.log("Error: longitude and latitude must be valid numbers");
    process.exit(1);
  }
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

module.exports = {
  invoke: handleUserInstruction,
  handleUserInstruction,
  sendInstruction,
  wrapInstruction
};
