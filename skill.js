const https = require("https");
const WebSocket = require("ws");

const WS_URL = "wss://www.shugan.tech/wss/";
const FREE_KEYWORDS = ['免费', '福利', '薅羊毛', '白嫖', '免费领取', '福利活动', '羊毛', '免费试用', '免费体验', '免费活动', '免费福利'];
const ACTIVITY_KEYWORDS = ['周年庆', '店庆', '节日活动', '店庆活动', '周年庆典', '品牌活动', '庆典', '春节', '元宵节', '端午节', '中秋节', '重阳节', '情人节', '母亲节', '父亲节', '儿童节', '圣诞节', '感恩节', '万圣节', '元旦', '双十一', '双十二', '618', '黑色星期五', '活动', '商场活动'];
const PROMO_KEYWORDS = ['促销', '优惠', '折扣', '打折', '商场', '特价', '优惠券', '满减', '限时优惠', '折扣券'];

function wrapInstruction(longitude, latitude, mode) {
  return JSON.stringify({
    command: 'sense',
    areaType: 1,
    gps: {lng: longitude, lat: latitude},
    senseRange: 2000,
    uuid: '0eb25ca4-8b72-49d2-a7c3-1e44f13d3d9a', //todo generate uuid randomly
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
    const req = https.get(url, { timeout: 10000 }, (res) => {
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
  if (mode === 'free' || mode === 'activity') {
    return {
      mode,
      mall_name: null
    };
  }

  return {
    mode,
    promotion_url_for_ai: `https://www.shugan.tech/building/queryPromotion/${uuid}/`,
    promotion_url_for_human: `https://www.shugan.tech/building/?bid=${uuid}#/pages/AiPoster/AiPoster`
  };
}

function filterUrlsByKeywords(obj, keywords) {
  const results = [];

  if (obj.shops && typeof obj.shops === 'object') {
    for (const [shopId, shopData] of Object.entries(obj.shops)) {
      if (shopData && typeof shopData === 'object' && shopData.url && typeof shopData.url === 'object') {
        const filtered = {};
        for (const [key, value] of Object.entries(shopData.url)) {
          if (typeof value === 'string' && keywords.some(word => key.includes(word))) {
            filtered[key] = value;
          }
        }
        if (Object.keys(filtered).length > 0) {
          results.push({
            name: shopData.name || 'Unknown Shop',
            filtered
          });
        }
      }
    }
  }

  return results;
}

function filterFreeUrls(obj) {
  return filterUrlsByKeywords(obj, FREE_KEYWORDS);
}

function filterActivityUrls(obj) {
  return filterUrlsByKeywords(obj, ACTIVITY_KEYWORDS);
}

function inferModeFromKeywords(keywordString) {
  if (!keywordString || typeof keywordString !== 'string') {
    return 'promotion';
  }
  const normalized = keywordString.toLowerCase();
  for (const word of FREE_KEYWORDS) {
    if (normalized.includes(word)) {
      return 'free';
    }
  }
  for (const word of ACTIVITY_KEYWORDS) {
    if (normalized.includes(word)) {
      return 'activity';
    }
  }
  for (const word of PROMO_KEYWORDS) {
    if (normalized.includes(word)) {
      return 'promotion';
    }
  }
  return 'promotion';
}

const NO_DATA_TIMEOUT_MS = 5000;

async function sendInstruction(longitude, latitude, mode, onChunk) {
  const payload = wrapInstruction(longitude, latitude, mode);
  const ws = createWebSocket();

  return new Promise((resolve, reject) => {
    let closed = false;
    let idleTimer = null;

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
            if (item && typeof item === 'object' && item.parameters && item.parameters.url) {
              const url = item.parameters.url;
              const bidIndex = url.indexOf('bid=');
              if (bidIndex !== -1) {
                const uuid = url.substring(bidIndex + 4).split('&')[0];
                const result = buildResultObject(uuid, mode);
                if (mode === 'free' || mode === 'activity') {
                  const buildingInfoUrl = `https://www.shugan.tech/building/buildingInfo/${uuid}/`;
                  const shopUrl = `https://www.shugan.tech/building/shopAndOffice/${uuid}/`;
                  try {
                    const buildingData = await fetchUrlContent(buildingInfoUrl);
                    const buildingJson = JSON.parse(buildingData);
                    if (buildingJson && typeof buildingJson.name === 'string') {
                      result.mall_name = buildingJson.name;
                    }
                  } catch (e) {
                    // ignore building info fetch failure, still return what we have
                  }

                  try {
                    const shopData = await fetchUrlContent(shopUrl);
                    const shopJson = JSON.parse(shopData);
                    const filtered = mode === 'activity' ? filterActivityUrls(shopJson) : filterFreeUrls(shopJson);
                    result.filtered = filtered;
                    if (filtered.length > 0 && typeof onChunk === "function") {
                      onChunk(JSON.stringify(result));
                    }
                  } catch (e) {
                    // no results if fetch or parse fails
                  }
                } else {
                  if (typeof onChunk === "function") {
                    onChunk(JSON.stringify(result));
                  }
                }
              } else {
                if (typeof onChunk === "function") {
                  onChunk("");
                }
              }
            } else {
              if (typeof onChunk === "function") {
                onChunk("");
              }
            }
          }
        } else {
          if (typeof onChunk === "function") {
            onChunk("");
          }
        }
      } catch (e) {
        if (typeof onChunk === "function") {
          onChunk("");
        }
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
        resolve({ code, reason: reason.toString() });
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

  const mode = options.mode || inferModeFromKeywords(options.keywords || options.query || '');
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
  const mode = args[2] || 'promotion';
  if (isNaN(longitude) || isNaN(latitude)) {
    console.log("Error: longitude and latitude must be valid numbers");
    process.exit(1);
  }
  if (mode !== 'promotion' && mode !== 'free' && mode !== 'activity') {
    console.log("Error: mode must be 'promotion', 'free', or 'activity'");
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