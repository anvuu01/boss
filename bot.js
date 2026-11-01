/*──────────────────────────────────────────────────────────────
  M-BOT — Node.js  |  Render & Web UI Edition
  ─ Tích hợp Web UI quản lý trực quan thời gian thực
  ─ Chế độ mặc định: "normal" (chuyển đổi realtime không cần restart)
  ─ Tối ưu 100% cho Render (auto port, health check, self keep-alive)
  ─ Khởi động an toàn: Không bị crash loop kể cả khi chưa nhập Token
  ─ Chống memory leak & tối ưu I/O debounce
──────────────────────────────────────────────────────────────*/
"use strict";

const { Client } = require("discord.js-selfbot-v13");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const fsp = require("fs/promises");
const fs = require("fs");
const path = require("path");

// Tự động nạp file .env nếu có
(function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  try {
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx <= 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch {}
})();

// ═══════════════════════════════════════════════════════
// 1. CẤU HÌNH & TRẠNG THÁI TOÀN CỤC
// ═══════════════════════════════════════════════════════
const PORT = process.env.PORT || 8080;
const CHANNEL_ID = "1381302690335952988";
const GUILD_ID = "1194106864582004849";
const FARM_EMOJI = "🔥";
const FETCH_LIMIT = 100;

// Mật khẩu bảo vệ Web UI
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "jdshfsjk(*(*SJHslkdj)827";
const AUTH_SECRET = "mbot-secure-salt-827-auth";
const activeSessions = new Set();

function generateAuthToken() {
  return crypto.createHmac("sha256", AUTH_SECRET).update(ADMIN_PASSWORD.trim()).digest("hex");
}

function verifyAuth(req) {
  // 1. Kiểm tra Cookie
  const cookieHeader = req.headers.cookie || "";
  const match = cookieHeader.match(/mbot_session=([a-zA-Z0-9_-]+)/);
  const correctToken = generateAuthToken();
  if (match && (match[1] === correctToken || activeSessions.has(match[1]))) {
    return true;
  }

  // 2. Kiểm tra Header Authorization hoặc x-admin-token
  const authHeader = req.headers.authorization || req.headers["x-admin-token"] || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (token && (token === correctToken || activeSessions.has(token))) {
    return true;
  }

  return false;
}

// Chế độ mặc định là "normal" theo yêu cầu
let currentMode = process.env.BOT_MODE || "normal";

const PROFILES = {
  safe: {
    label: "Safe (An toàn cao)",
    concurrent: 2,
    reactMin: 800,
    reactMax: 1500,
    loopPause: 8000,
    globalCooldown: 300,
  },
  normal: {
    label: "Normal (Cân bằng - Mặc định)",
    concurrent: 3,
    reactMin: 500,
    reactMax: 900,
    loopPause: 5000,
    globalCooldown: 150,
  },
  fast: {
    label: "Fast (Tốc độ cao)",
    concurrent: 4,
    reactMin: 350,
    reactMax: 600,
    loopPause: 3000,
    globalCooldown: 0,
  },
};

const CATEGORIES = [
  {
    id: "1281146625435369472",
    excluded: new Set([
      "1229710841927045222", "1246901718143205437", "1516859270140792842",
      "1516859246476787933", "1517099249257414777", "1196522451857842287",
      "1232731962834161775", "1437860347032895518", "1390315019006251008",
      "1281171567513960461", "1357284374684500159",
    ]),
  },
];

const PROGRESS_FILE = path.join(__dirname, "progress.json");
const startTime = Date.now();

// Trạng thái điều khiển qua UI
const controls = {
  autoReact: true,
  spamEmoji: true,
  autoBoss: true,
};

// Thống kê
const stats = {
  totalReactsThisSession: 0,
  rateLimitHits: 0,
  current429Streak: 0,
  lastBossAction: null,
  activeWorkerChannels: [],
};

// Log buffer cho Web UI (tối đa 120 dòng gần nhất)
const logBuffer = [];
function addLog(type, message) {
  const time = new Date().toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  const entry = { time, type, message };
  logBuffer.push(entry);
  if (logBuffer.length > 120) logBuffer.shift();
  console.log(`[${time}] [${type}] ${message}`);
}

// ═══════════════════════════════════════════════════════
// 2. DISCORD CLIENT KHỞI TẠO (GIẢ LẬP WINDOWS DESKTOP CLIENT)
// ═══════════════════════════════════════════════════════
function createDiscordClient() {
  const c = new Client({
    checkUpdate: false,
    autoRedeemNitro: false,
    http: {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9188 Chrome/130.0.6723.191 Electron/33.4.0 Safari/537.36',
      },
    },
    ws: {
      properties: {
        os: 'Windows',
        browser: 'Discord Client',
        release_channel: 'stable',
        client_version: '1.0.9188',
        os_version: '10.0.19045',
        os_arch: 'x64',
        system_locale: 'en-US',
      },
    },
  });

  c.once("ready", () => {
    botIsReady = true;
    if (loginTimeoutTimer) {
      clearTimeout(loginTimeoutTimer);
      loginTimeoutTimer = null;
    }
    c.user.setStatus("invisible");
    addLog("READY", `Đăng nhập thành công: ${c.user.tag} (ID: ${c.user.id})`);
    addLog("READY", `Chế độ: ${currentMode.toUpperCase()} | Đang bắt đầu chu trình quét`);

    startSpamEmoji();
    startCacheSweeper();
    doReactLoop();
  });

  c.on("error", (err) => {
    addLog("ERROR", `Discord Error: ${err.message}`);
  });

  c.on("shardError", (err) => {
    addLog("ERROR", `Discord Shard Error: ${err.message}`);
  });

  c.on("shardDisconnect", (event) => {
    addLog("AUTH", `Mất kết nối Gateway (Code: ${event.code}, Lý do: ${event.reason || "Không rõ"})`);
  });

  c.on("warn", (warn) => {
    addLog("WARN", `Cảnh báo Discord: ${warn}`);
  });

  // Bắt các thông điệp Debug quan trọng từ WebSocket Gateway để hiển thị lên Web UI
  c.on("debug", (info) => {
    const text = String(info || "");
    if (
      text.includes("429") ||
      text.includes("Rate limit") ||
      text.includes("Session") ||
      text.includes("Heartbeat") ||
      text.includes("Connecting") ||
      text.includes("Identify") ||
      text.includes("Close") ||
      text.includes("401") ||
      text.includes("Invalid") ||
      text.includes("captcha") ||
      text.includes("gateway")
    ) {
      addLog("DEBUG", text);
    }
  });

  // Sự kiện nhận tin nhắn săn Boss
  c.on("messageCreate", handleBossMessage);

  return c;
}

let client = createDiscordClient();
let botIsReady = false;
let discordToken = "";
let loginTimeoutTimer = null;

// ═══════════════════════════════════════════════════════
// 3. TIỆN ÍCH & TÍNH TOÁN BOSS TIME
// ═══════════════════════════════════════════════════════
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randMs = (lo, hi) => lo + Math.random() * (hi - lo);

function getBossStatus() {
  const now = new Date(Date.now() + 25_200_000); // UTC+7
  const curMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const curSec = now.getUTCSeconds();

  // Khung 1: 11:55 - 12:20 (715 - 740)
  // Khung 2: 19:10 - 19:35 (1150 - 1175)
  const isNow = (curMinutes >= 715 && curMinutes <= 740) ||
                (curMinutes >= 1150 && curMinutes <= 1175);

  let nextTargetMinutes = 715;
  if (curMinutes < 715) {
    nextTargetMinutes = 715;
  } else if (curMinutes <= 740) {
    nextTargetMinutes = 740; // Đang trong hiệp 1
  } else if (curMinutes < 1150) {
    nextTargetMinutes = 1150;
  } else if (curMinutes <= 1175) {
    nextTargetMinutes = 1175; // Đang trong hiệp 2
  } else {
    nextTargetMinutes = 715 + 1440; // Ngày hôm sau
  }

  const diffSec = ((nextTargetMinutes - curMinutes) * 60) - curSec;
  const h = Math.floor(Math.max(0, diffSec) / 3600);
  const m = Math.floor((Math.max(0, diffSec) % 3600) / 60);
  const s = Math.max(0, diffSec) % 60;
  const countdown = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;

  return { isNow, countdown, currentMinutes: curMinutes };
}

// ═══════════════════════════════════════════════════════
// 4. TIẾN TRÌNH & ASYNC DEBOUNCED SAVE
// ═══════════════════════════════════════════════════════
let progress = {};
let savePending = false;
let saveTimer = null;

async function loadProgress() {
  try {
    const raw = await fsp.readFile(PROGRESS_FILE, "utf-8");
    progress = JSON.parse(raw);
  } catch {
    progress = {};
  }
}

function scheduleSave() {
  if (saveTimer) return;
  savePending = true;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    if (!savePending) return;
    savePending = false;
    try {
      const tmp = PROGRESS_FILE + ".tmp";
      await fsp.writeFile(tmp, JSON.stringify(progress, null, 2), "utf-8");
      await fsp.rename(tmp, PROGRESS_FILE);
    } catch (e) {
      addLog("ERROR", `Lỗi lưu progress: ${e.message}`);
    }
  }, 2000);
}

async function flushSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (savePending) {
    savePending = false;
    try {
      await fsp.writeFile(PROGRESS_FILE, JSON.stringify(progress, null, 2), "utf-8");
    } catch { /* silent */ }
  }
}

// ═══════════════════════════════════════════════════════
// 5. SEMAPHORE TÙY BIẾN THEO CHẾ ĐỘ
// ═══════════════════════════════════════════════════════
class DynamicSemaphore {
  constructor() {
    this.cur = 0;
    this.queue = [];
  }
  getMax() {
    const p = PROFILES[currentMode] || PROFILES.normal;
    return p.concurrent;
  }
  acquire() {
    if (this.cur < this.getMax()) {
      this.cur++;
      return Promise.resolve();
    }
    return new Promise((r) => this.queue.push(r));
  }
  release() {
    this.cur--;
    if (this.queue.length && this.cur < this.getMax()) {
      this.cur++;
      this.queue.shift()();
    }
  }
}

// ═══════════════════════════════════════════════════════
// 6. ENGINE REACT TIN NHẮN CŨ
// ═══════════════════════════════════════════════════════
async function reactWithRetry(message, emoji, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await message.react(emoji);
      if (stats.current429Streak > 0) {
        addLog("RATE", `Phục hồi khỏi 429 sau ${stats.current429Streak} lần liên tiếp`);
        stats.current429Streak = 0;
      }
      return true;
    } catch (err) {
      const status = err.httpStatus || err.status;
      if (status === 429) {
        stats.rateLimitHits++;
        stats.current429Streak++;
        const discordWait = (err.retryAfter || err.retry_after || 1) * 1000;
        const backoff = Math.min(2000 * Math.pow(1.5, stats.current429Streak - 1), 60000);
        const totalWait = discordWait + backoff;

        addLog("RATE", `Gặp 429 (#${stats.current429Streak}) — Tạm nghỉ ${(totalWait / 1000).toFixed(1)}s`);

        if (stats.current429Streak >= 5) {
          addLog("RATE", `⚠️ Đạt streak 5 lần 429 liên tiếp — Tạm dừng 60s để Discord hạ nhiệt`);
          await sleep(60000);
          stats.current429Streak = 2;
          return false;
        }

        await sleep(totalWait);
        continue;
      }
      return false;
    }
  }
  return false;
}

function pickEmoji(message) {
  if (message.reactions.cache.size > 0) {
    const e = message.reactions.cache.first().emoji;
    return e.id ? `${e.name}:${e.id}` : e.name;
  }
  return FARM_EMOJI;
}

async function processChannel(channel) {
  const key = channel.id;
  const p = progress[key] || {};
  let afterId = p.last_reacted_id || null;
  let reacted = p.total_reacted || 0;
  let lastReactedId = null;

  stats.activeWorkerChannels.push(channel.name || key);

  let hasMore = true;
  while (hasMore && controls.autoReact) {
    let messages;
    try {
      const opts = { limit: FETCH_LIMIT };
      if (afterId) opts.after = afterId;
      messages = await channel.messages.fetch(opts);
    } catch (e) {
      break;
    }

    if (!messages || messages.size === 0) break;
    hasMore = messages.size === FETCH_LIMIT;

    const sorted = [...messages.values()].sort(
      (a, b) => a.createdTimestamp - b.createdTimestamp
    );

    for (const msg of sorted) {
      if (!controls.autoReact) break;
      if (msg.author.bot) { afterId = msg.id; continue; }

      const profile = PROFILES[currentMode] || PROFILES.normal;
      await sleep(randMs(profile.reactMin, profile.reactMax));
      if (profile.globalCooldown > 0) await sleep(profile.globalCooldown);

      if (await reactWithRetry(msg, pickEmoji(msg))) {
        reacted++;
        stats.totalReactsThisSession++;
        lastReactedId = msg.id;
      }
      afterId = msg.id;
    }

    if (lastReactedId) {
      progress[key] = {
        name: channel.name,
        last_reacted_id: lastReactedId,
        total_reacted: reacted,
        last_updated: new Date().toISOString(),
      };
      scheduleSave();
    }
  }

  stats.activeWorkerChannels = stats.activeWorkerChannels.filter((c) => c !== (channel.name || key));
}

function refreshChannelList() {
  const list = [];
  for (const cat of CATEGORIES) {
    const category = client.channels.cache.get(cat.id);
    if (!category || !category.children) continue;
    const children = category.children.cache || category.children;
    for (const [, ch] of children) {
      if (ch.type === 0 && !cat.excluded.has(ch.id)) list.push(ch);
    }
  }
  return list;
}

async function doReactLoop() {
  await loadProgress();
  const sem = new DynamicSemaphore();

  while (true) {
    if (!controls.autoReact) {
      await sleep(4000);
      continue;
    }

    const channels = refreshChannelList();
    if (channels.length === 0) {
      await sleep(8000);
      continue;
    }

    const jobs = channels.map(async (ch) => {
      await sem.acquire();
      try {
        if (controls.autoReact) await processChannel(ch);
      } finally {
        sem.release();
      }
    });

    await Promise.allSettled(jobs);
    await flushSave();
    const profile = PROFILES[currentMode] || PROFILES.normal;
    await sleep(profile.loopPause);
  }
}

// ═══════════════════════════════════════════════════════
// 7. AUTO SPAM EMOJI THEO CHU KỲ (TỐI ƯU CHỐNG SLOWMODE 1 PHÚT)
// ═══════════════════════════════════════════════════════
let emojiCache = [];
let emojiCacheAge = 0;

async function runSpamEmojiLoop() {
  while (true) {
    if (!controls.spamEmoji || !botIsReady) {
      await sleep(3000);
      continue;
    }

    try {
      const guild = client.guilds.cache.get(GUILD_ID);
      const channel = client.channels.cache.get(CHANNEL_ID);
      if (guild && channel) {
        if (Date.now() - emojiCacheAge > 300_000 || emojiCache.length === 0) {
          emojiCache = [...guild.emojis.cache.values()];
          emojiCacheAge = Date.now();
        }

        if (emojiCache.length > 0) {
          const pick = emojiCache[(Math.random() * emojiCache.length) | 0];
          await channel.send(`${pick}`);
          addLog("SPAM", `Đã gửi emoji: ${pick} (kênh #${channel.name || CHANNEL_ID})`);
        }

        // Tự động nhận diện Slowmode của kênh (mặc định 60s nếu chưa load)
        const slowmodeSec = channel.rateLimitPerUser || 60;
        // Khoảng thời gian tối ưu: Thời gian Slowmode + 1.2s bù trừ độ trễ mạng
        // Giúp 100% không bao giờ bị Discord chặn vì gửi sớm vài mili-giây
        const optimalDelayMs = (slowmodeSec * 1000) + 1200;
        await sleep(optimalDelayMs);
        continue;
      }
    } catch (e) {
      const status = e.status || e.httpStatus;
      if (status === 429) {
        const retryAfter = (e.retryAfter || e.retry_after || 5) * 1000 + 1000;
        addLog("SPAM", `Dính Slowmode Discord: Tự động chờ ${(retryAfter / 1000).toFixed(1)}s rồi gửi tiếp...`);
        await sleep(retryAfter);
        continue;
      } else {
        addLog("ERROR", `Spam emoji thất bại: ${e.message}`);
      }
    }

    // Thời gian dự phòng: 61.2s
    await sleep(61_200);
  }
}

function startSpamEmoji() {
  runSpamEmojiLoop();
}

// ═══════════════════════════════════════════════════════
// 8. AUTO ĐÁNH BOSS (COMPONENTS / BUTTON CLICK)
// ═══════════════════════════════════════════════════════
async function handleBossMessage(message) {
  if (!controls.autoBoss) return;
  const boss = getBossStatus();
  if (!boss.isNow) return;
  if (!message.author.bot || !message.components || message.components.length === 0) return;

  for (const row of message.components) {
    for (const comp of row.components) {
      const label = comp.label || "";
      const eName = comp.emoji?.name || "";

      if (label.includes("Đánh Boss") || eName === "⚔️") {
        try {
          const delay = randMs(2500, 5000);
          addLog("BOSS", `Phát hiện Boss! Chờ ${(delay / 1000).toFixed(1)}s rồi bấm nút "${label || eName}"`);
          await sleep(delay);
          await message.clickButton(comp.customId);
          stats.lastBossAction = `${new Date().toLocaleTimeString("vi-VN")} - Đã bấm đánh Boss`;
          addLog("BOSS", `✅ Đã click nút đánh Boss thành công!`);
        } catch (err) {
          addLog("ERROR", `Lỗi khi click nút Boss: ${err.message}`);
        }
        return;
      }
    }
  }
}

// ═══════════════════════════════════════════════════════
// 9. DỌN DẸP BỘ NHỚ ĐỊNH KỲ
// ═══════════════════════════════════════════════════════
function startCacheSweeper() {
  setInterval(() => {
    let swept = 0;
    for (const [, ch] of client.channels.cache) {
      if (ch.messages?.cache.size > 0) {
        swept += ch.messages.cache.size;
        ch.messages.cache.clear();
      }
    }
    if (swept > 0) {
      addLog("SWEEP", `Đã giải phóng cache ${swept} tin nhắn cũ`);
    }
  }, 120_000);
}

// ═══════════════════════════════════════════════════════
// 10. RENDER SELF-PING KEEP-ALIVE (CHỐNG NGỦ RENDER FREE)
// ═══════════════════════════════════════════════════════
function startRenderKeepAlive() {
  const externalUrl = process.env.RENDER_EXTERNAL_URL;
  if (!externalUrl) {
    addLog("RENDER", "Chưa có RENDER_EXTERNAL_URL (chạy local hoặc chưa cấu hình). Web server vẫn phục vụ bình thường.");
    return;
  }

  addLog("RENDER", `Đã kích hoạt Self Keep-Alive cho URL: ${externalUrl}`);
  // Render Free ngủ sau 15 phút không có request. Ping mỗi 10 phút.
  setInterval(() => {
    const pingTarget = `${externalUrl.replace(/\/$/, "")}/health`;
    const clientReq = externalUrl.startsWith("https") ? https : http;
    clientReq.get(pingTarget, (res) => {
      addLog("RENDER", `Self-ping ${pingTarget} -> Status ${res.statusCode}`);
    }).on("error", (e) => {
      addLog("RENDER", `Self-ping lỗi nhẹ: ${e.message}`);
    });
  }, 10 * 60 * 1000);
}

// ═══════════════════════════════════════════════════════
// 11. KHỞI CHẠY BOT AN TOÀN VÀ LÀM SẠCH TOKEN
// ═══════════════════════════════════════════════════════
function detectEnvironmentToken() {
  const envCandidates = [
    "DISCORD_TOKEN",
    "TOKEN",
    "BOT_TOKEN",
    "USER_TOKEN",
    "DISCORD_USER_TOKEN",
    "AUTH_TOKEN"
  ];
  for (const name of envCandidates) {
    if (process.env[name] && process.env[name].trim()) {
      return { key: name, raw: process.env[name] };
    }
  }
  return { key: null, raw: "" };
}

function sanitizeToken(token) {
  if (!token) return "";
  let clean = String(token).trim();
  // Loại bỏ dấu nháy kép hoặc đơn ("..." hoặc '...')
  clean = clean.replace(/^["']|["']$/g, "").trim();
  // Loại bỏ tiền tố "Bot " nếu người dùng lỡ copy
  if (clean.toLowerCase().startsWith("bot ")) {
    clean = clean.slice(4).trim();
  }
  return clean;
}

async function tryLogin(tokenInput, sourceName = "Môi trường") {
  const token = sanitizeToken(tokenInput);
  if (!token) {
    addLog("AUTH", "⚠️ Chưa tìm thấy Token. Hãy cấu hình DISCORD_TOKEN trên Render hoặc nhập qua Web UI.");
    return false;
  }

  discordToken = token;
  const masked = token.length > 8 ? `${token.slice(0, 4)}...${token.slice(-4)}` : "***";
  addLog("AUTH", `Kiểm tra Token (${sourceName}): Độ dài ${token.length} ký tự, dạng [${masked}]`);

  if (token.length < 50) {
    addLog("WARN", `⚠️ Token có độ dài ${token.length} ký tự. Lưu ý Token User Discord thông thường dài khoảng 59-75 ký tự.`);
  }

  try {
    if (botIsReady) {
      client.destroy();
      client = createDiscordClient();
      botIsReady = false;
    }

    if (loginTimeoutTimer) clearTimeout(loginTimeoutTimer);
    loginTimeoutTimer = setTimeout(() => {
      if (!botIsReady) {
        addLog("WARN", "⚠️ Đã quá 15s chưa nhận phản hồi Gateway. Nếu vẫn bị treo, hãy kiểm tra: (1) Token có bị đổi chưa, (2) Đăng nhập web discord.com xem tài khoản có bị đòi Captcha/SĐT không.");
      }
    }, 15000);

    addLog("AUTH", "Đang gửi yêu cầu đăng nhập Gateway...");
    await client.login(token);
    return true;
  } catch (err) {
    addLog("ERROR", `Không thể đăng nhập Discord: ${err.message}`);
    return false;
  }
}

// ═══════════════════════════════════════════════════════
// 12. WEB UI & REST API SERVER
// ═══════════════════════════════════════════════════════
function renderHtml() {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>M-Bot Control Panel</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: rgba(18, 24, 38, 0.75);
      --card-border: rgba(255, 255, 255, 0.08);
      --primary: #6366f1;
      --primary-hover: #4f46e5;
      --primary-glow: rgba(99, 102, 241, 0.25);
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --text: #f3f4f6;
      --text-muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      background-image: 
        radial-gradient(circle at 15% 15%, rgba(99, 102, 241, 0.15) 0%, transparent 40%),
        radial-gradient(circle at 85% 85%, rgba(16, 185, 129, 0.1) 0%, transparent 40%);
      color: var(--text);
      font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
      min-height: 100vh;
      padding: 24px 16px;
    }
    .container { max-width: 1060px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }
    
    /* Header */
    .header {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      backdrop-filter: blur(12px);
      border-radius: 16px;
      padding: 20px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
    }
    .brand { display: flex; align-items: center; gap: 14px; }
    .logo {
      width: 44px; height: 44px;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      border-radius: 12px;
      display: flex; align-items: center; justify-content: center;
      font-size: 22px; box-shadow: 0 4px 14px var(--primary-glow);
    }
    .brand h1 { font-size: 20px; font-weight: 700; letter-spacing: -0.5px; }
    .brand p { font-size: 13px; color: var(--text-muted); }
    .badge {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px; border-radius: 999px;
      font-size: 12px; font-weight: 600;
    }
    .badge.online { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .badge.offline { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
    .badge.waiting { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }

    /* Alert Banner */
    .banner {
      background: rgba(245, 158, 11, 0.12);
      border: 1px solid rgba(245, 158, 11, 0.3);
      border-radius: 12px;
      padding: 14px 18px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      font-size: 14px;
    }

    /* Grid layout */
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      backdrop-filter: blur(12px);
      border-radius: 16px;
      padding: 20px;
      display: flex; flex-direction: column; gap: 10px;
    }
    .card-title { font-size: 13px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
    .card-val { font-size: 26px; font-weight: 800; color: #fff; }
    .card-desc { font-size: 12px; color: var(--text-muted); }

    /* Mode Selector */
    .section-title { font-size: 16px; font-weight: 700; margin-bottom: 8px; }
    .mode-group {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
    }
    @media (max-width: 680px) { .mode-group { grid-template-columns: 1fr; } }
    .mode-btn {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 14px;
      cursor: pointer;
      text-align: left;
      transition: all 0.2s ease;
      color: var(--text);
    }
    .mode-btn:hover { border-color: rgba(99, 102, 241, 0.4); background: rgba(99, 102, 241, 0.05); }
    .mode-btn.active {
      background: rgba(99, 102, 241, 0.15);
      border-color: var(--primary);
      box-shadow: 0 0 16px var(--primary-glow);
    }
    .mode-btn strong { display: block; font-size: 14px; margin-bottom: 4px; }
    .mode-btn span { font-size: 12px; color: var(--text-muted); line-height: 1.4; display: block; }

    /* Toggles */
    .toggle-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    .toggle-row:last-child { border-bottom: none; }
    .toggle-info h4 { font-size: 14px; font-weight: 600; }
    .toggle-info p { font-size: 12px; color: var(--text-muted); }
    
    .switch {
      position: relative; display: inline-block; width: 46px; height: 26px;
    }
    .switch input { opacity: 0; width: 0; height: 0; }
    .slider {
      position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0;
      background-color: rgba(255, 255, 255, 0.15);
      transition: .3s; border-radius: 999px;
    }
    .slider:before {
      position: absolute; content: ""; height: 20px; width: 20px; left: 3px; bottom: 3px;
      background-color: white; transition: .3s; border-radius: 50%;
    }
    input:checked + .slider { background-color: var(--primary); }
    input:checked + .slider:before { transform: translateX(20px); }

    /* Channel table */
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; text-align: left; }
    th { padding: 10px 12px; color: var(--text-muted); font-weight: 600; border-bottom: 1px solid var(--card-border); }
    td { padding: 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.04); }
    tr:last-child td { border-bottom: none; }

    /* Logs Console */
    .console {
      background: #050811;
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 14px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      height: 260px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .log-line { display: flex; gap: 8px; line-height: 1.5; word-break: break-all; }
    .log-time { color: #64748b; flex-shrink: 0; }
    .log-tag {
      padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; flex-shrink: 0;
    }
    .tag-READY { background: #064e3b; color: #34d399; }
    .tag-RATE  { background: #78350f; color: #fbbf24; }
    .tag-BOSS  { background: #4c1d95; color: #c084fc; }
    .tag-SPAM  { background: #1e3a8a; color: #60a5fa; }
    .tag-SWEEP { background: #312e81; color: #818cf8; }
    .tag-RENDER{ background: #134e4a; color: #2dd4bf; }
    .tag-ERROR { background: #7f1d1d; color: #f87171; }
    .tag-AUTH  { background: #3b0764; color: #e879f9; }
    .tag-DEBUG { background: #1e293b; color: #94a3b8; }
    .tag-WARN  { background: #78350f; color: #fde047; }
    .tag-MODE  { background: #1e1b4b; color: #a5b4fc; }

    /* Button */
    .btn {
      background: var(--primary); color: white; border: none;
      padding: 8px 16px; border-radius: 8px; font-weight: 600; font-size: 13px;
      cursor: pointer; transition: background 0.2s;
    }
    .btn:hover { background: var(--primary-hover); }
    .btn-sm { padding: 6px 12px; font-size: 12px; }
    input[type="text"], input[type="password"] {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--card-border);
      color: #fff; padding: 8px 12px; border-radius: 8px; font-size: 13px; outline: none;
    }
    input[type="text"]:focus, input[type="password"]:focus { border-color: var(--primary); }

    /* Login Modal Overlay */
    .login-wrapper {
      position: fixed; inset: 0; background: rgba(9, 13, 22, 0.94);
      backdrop-filter: blur(20px); z-index: 9999;
      display: flex; align-items: center; justify-content: center; padding: 20px;
    }
    .login-card {
      background: rgba(18, 24, 38, 0.92); border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 20px; padding: 36px 30px; max-width: 420px; width: 100%;
      text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,0.6);
      display: flex; flex-direction: column; gap: 14px;
    }
    .login-icon {
      width: 58px; height: 58px; border-radius: 16px;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      display: flex; align-items: center; justify-content: center;
      font-size: 26px; margin: 0 auto 4px; box-shadow: 0 8px 24px var(--primary-glow);
    }
    .login-card h2 { font-size: 22px; font-weight: 700; color: #fff; }
    .login-card p { font-size: 13px; color: var(--text-muted); line-height: 1.5; }
    .login-error {
      background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3);
      color: #f87171; padding: 10px; border-radius: 8px; font-size: 13px; font-weight: 600;
    }
    .input-group { position: relative; width: 100%; }
    .input-group input {
      width: 100%; padding: 12px 42px 12px 14px; background: rgba(255,255,255,0.06);
      border: 1px solid var(--card-border); border-radius: 10px; color: #fff; font-size: 14px;
    }
    .btn-toggle-pass {
      position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
      background: none; border: none; cursor: pointer; color: var(--text-muted); font-size: 16px;
    }
    .btn-login { width: 100%; padding: 12px; font-size: 14px; margin-top: 4px; }
    .login-hint { font-size: 11px; color: #64748b; margin-top: 4px; }
  </style>
</head>
<body>
  <!-- Màn hình Đăng nhập Mật khẩu Bảo Mật -->
  <div id="loginOverlay" class="login-wrapper">
    <div class="login-card">
      <div class="login-icon">🔒</div>
      <h2>M-Bot Security</h2>
      <p>Bảng điều khiển được bảo mật. Vui lòng nhập mật khẩu quản trị để tiếp tục.</p>
      <div id="loginError" class="login-error" style="display: none;"></div>
      <form id="loginForm" onsubmit="handleLogin(event)" style="display: flex; flex-direction: column; gap: 12px; margin-top: 6px;">
        <div class="input-group">
          <input type="password" id="adminPasswordInput" placeholder="Nhập mật khẩu quản trị..." autocomplete="current-password" required>
          <button type="button" class="btn-toggle-pass" onclick="togglePasswordVisibility()" title="Ẩn/Hiện">👁️</button>
        </div>
        <button type="submit" class="btn btn-login" id="loginBtn">Mở Khóa Bảng Điều Khiển</button>
      </form>
      <div class="login-hint">Render Node.js • Multi-channel Selfbot</div>
    </div>
  </div>

  <div class="container" id="mainDashboard" style="display: none;">
    
    <!-- Header -->
    <div class="header">
      <div class="brand">
        <div class="logo">⚡</div>
        <div>
          <h1>M-Bot Dashboard</h1>
          <p id="subinfo">Render Deployment • Node.js Optimized</p>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 10px;">
        <span id="botStatusBadge" class="badge waiting">
          <span class="dot"></span> <span id="botStatusText">Đang khởi động...</span>
        </span>
        <span id="uptimeBadge" class="badge" style="background: rgba(255,255,255,0.05); color: #cbd5e1;">Uptime: 0m</span>
        <button class="btn btn-sm" style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.3);" onclick="handleLogout()" title="Đăng xuất">🔒 Thoát</button>
      </div>
    </div>

    <!-- Token warning banner (nếu chưa có Token) -->
    <div id="tokenBanner" class="banner" style="display: none;">
      <div>
        <strong>⚠️ Chưa kết nối Discord:</strong> Vui lòng cung cấp <code>DISCORD_TOKEN</code> để bot bắt đầu cày.
      </div>
      <div style="display: flex; gap: 8px;">
        <input type="text" id="tokenInput" placeholder="Nhập Discord Token..." style="width: 220px;">
        <button class="btn btn-sm" onclick="saveToken()">Lưu & Đăng nhập</button>
      </div>
    </div>

    <!-- Quick Stats -->
    <div class="grid">
      <div class="card">
        <div class="card-title">Tổng Reaction Đã Thả</div>
        <div class="card-val" id="totalReacts">0</div>
        <div class="card-desc">Phiên hiện tại: <span id="sessionReacts">0</span> reaction</div>
      </div>
      <div class="card">
        <div class="card-title">Chế Độ Hoạt Động</div>
        <div class="card-val" id="currentModeLabel" style="color: #818cf8;">NORMAL</div>
        <div class="card-desc" id="currentModeDesc">3 kênh song song • 500-900ms</div>
      </div>
      <div class="card">
        <div class="card-title">Tình Trạng Rate Limit</div>
        <div class="card-val" id="rateLimitVal" style="color: #34d399;">0</div>
        <div class="card-desc">Streak 429 hiện tại: <span id="streakVal">0</span></div>
      </div>
      <div class="card">
        <div class="card-title">Săn Boss Tự Động</div>
        <div class="card-val" id="bossStatusVal">Đang Chờ</div>
        <div class="card-desc">Đếm ngược hiệp kế: <span id="bossCountdown">--:--:--</span></div>
      </div>
    </div>

    <!-- Controls & Mode Selector -->
    <div class="grid" style="grid-template-columns: 2fr 1fr;">
      
      <!-- Chế độ -->
      <div class="card">
        <div class="section-title">⚡ Chọn Chế Độ Tốc Độ (Áp dụng tức thì)</div>
        <div class="mode-group">
          <div class="mode-btn" id="mode-safe" onclick="setMode('safe')">
            <strong style="color: #34d399;">🛡️ SAFE</strong>
            <span>2 kênh • 800-1500ms<br>An toàn tối đa, không sợ 429</span>
          </div>
          <div class="mode-btn" id="mode-normal" onclick="setMode('normal')">
            <strong style="color: #818cf8;">⚖️ NORMAL (Mặc định)</strong>
            <span>3 kênh • 500-900ms<br>Tốc độ cao nhưng vẫn giữ độ an toàn</span>
          </div>
          <div class="mode-btn" id="mode-fast" onclick="setMode('fast')">
            <strong style="color: #f87171;">🔥 FAST</strong>
            <span>4 kênh • 350-600ms<br>Tốc độ bàn thờ, có thể gặp 429</span>
          </div>
        </div>
      </div>

      <!-- Toggles -->
      <div class="card">
        <div class="section-title">⚙️ Tính Năng Bật/Tắt</div>
        
        <div class="toggle-row">
          <div class="toggle-info">
            <h4>Auto React Quét Kênh</h4>
            <p>Thả reaction bài viết cũ</p>
          </div>
          <label class="switch">
            <input type="checkbox" id="toggleAutoReact" checked onchange="toggleSetting('autoReact', this.checked)">
            <span class="slider"></span>
          </label>
        </div>

        <div class="toggle-row">
          <div class="toggle-info">
            <h4>Auto Spam Emoji</h4>
            <p>Mỗi 60s gửi 1 icon random</p>
          </div>
          <label class="switch">
            <input type="checkbox" id="toggleSpamEmoji" checked onchange="toggleSetting('spamEmoji', this.checked)">
            <span class="slider"></span>
          </label>
        </div>

        <div class="toggle-row">
          <div class="toggle-info">
            <h4>Auto Bấm Đánh Boss</h4>
            <p>Tự click nút khi tới giờ Boss</p>
          </div>
          <label class="switch">
            <input type="checkbox" id="toggleAutoBoss" checked onchange="toggleSetting('autoBoss', this.checked)">
            <span class="slider"></span>
          </label>
        </div>

      </div>

    </div>

    <!-- Active Channels Table -->
    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <div class="section-title" style="margin-bottom:0;">📊 Tiến Độ Từng Kênh Trong Danh Mục</div>
        <span id="activeWorkersBadge" style="font-size: 12px; color: var(--text-muted);">Đang quét: 0 kênh</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID Kênh</th>
              <th>Tên Kênh</th>
              <th>Đã React</th>
              <th>Tin Nhắn Cuối Cùng</th>
              <th>Cập Nhật Lần Cuối</th>
            </tr>
          </thead>
          <tbody id="channelsBody">
            <tr><td colspan="5" style="text-align:center; color:#64748b;">Đang tải dữ liệu tiến trình...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Live Console Logs -->
    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div class="section-title" style="margin-bottom: 0;">📜 Nhật Ký Hoạt Động Thời Gian Thực</div>
        <button class="btn btn-sm" style="background: rgba(255,255,255,0.08);" onclick="fetchStatus()">Làm mới</button>
      </div>
      <div class="console" id="consoleLogs">
        <div style="color: #64748b;">Đang kết nối WebSocket/Polling logs...</div>
      </div>
    </div>

  </div>

  <script>
    let activeMode = 'normal';

    async function fetchStatus() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();
        updateUI(data);
      } catch (e) {
        console.error("Lỗi fetch status", e);
      }
    }

    function updateUI(data) {
      // Bot Status
      const badge = document.getElementById('botStatusBadge');
      const text = document.getElementById('botStatusText');
      if (data.botReady) {
        badge.className = 'badge online';
        text.textContent = '🟢 ' + data.userTag;
        document.getElementById('tokenBanner').style.display = 'none';
      } else if (!data.hasToken) {
        badge.className = 'badge offline';
        text.textContent = '🔴 Chưa có Token';
        document.getElementById('tokenBanner').style.display = 'flex';
      } else {
        badge.className = 'badge waiting';
        text.textContent = '🟡 Đang kết nối...';
      }

      document.getElementById('uptimeBadge').textContent = 'Uptime: ' + data.uptime;

      // Stats
      document.getElementById('totalReacts').textContent = (data.totalAllTimeReacts || 0).toLocaleString();
      document.getElementById('sessionReacts').textContent = (data.sessionReacts || 0).toLocaleString();

      // Rate limit
      const rlVal = document.getElementById('rateLimitVal');
      rlVal.textContent = data.rateLimitHits;
      rlVal.style.color = data.rateLimitHits > 0 ? '#fbbf24' : '#34d399';
      document.getElementById('streakVal').textContent = data.current429Streak;

      // Boss
      const bVal = document.getElementById('bossStatusVal');
      if (data.boss.isNow) {
        bVal.textContent = '🔥 ĐANG ĐÁNH';
        bVal.style.color = '#ef4444';
      } else {
        bVal.textContent = 'Đang Chờ';
        bVal.style.color = '#38bdf8';
      }
      document.getElementById('bossCountdown').textContent = data.boss.countdown;

      // Mode
      activeMode = data.mode;
      document.getElementById('currentModeLabel').textContent = data.mode.toUpperCase();
      document.getElementById('currentModeDesc').textContent = data.modeDesc;
      ['safe', 'normal', 'fast'].forEach(m => {
        const el = document.getElementById('mode-' + m);
        if (el) el.classList.toggle('active', m === data.mode);
      });

      // Toggles
      document.getElementById('toggleAutoReact').checked = data.controls.autoReact;
      document.getElementById('toggleSpamEmoji').checked = data.controls.spamEmoji;
      document.getElementById('toggleAutoBoss').checked = data.controls.autoBoss;

      // Channel progress
      document.getElementById('activeWorkersBadge').textContent = 'Đang quét: ' + (data.activeWorkers.length || 0) + ' kênh';
      const tb = document.getElementById('channelsBody');
      const keys = Object.keys(data.progress || {});
      if (keys.length === 0) {
        tb.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#64748b;">Chưa có dữ liệu tiến trình nào được ghi nhận.</td></tr>';
      } else {
        tb.innerHTML = keys.map(k => {
          const item = data.progress[k];
          const isScanning = data.activeWorkers.includes(item.name || k);
          return '<tr>' +
            '<td><code>' + k + '</code></td>' +
            '<td><strong>' + (item.name || 'Channel') + '</strong> ' + (isScanning ? '<span style="color:#10b981;">(Đang quét)</span>' : '') + '</td>' +
            '<td>' + (item.total_reacted || 0).toLocaleString() + '</td>' +
            '<td><code>' + (item.last_reacted_id || '-') + '</code></td>' +
            '<td style="color:#94a3b8; font-size:11px;">' + (item.last_updated ? new Date(item.last_updated).toLocaleTimeString() : '-') + '</td>' +
          '</tr>';
        }).join('');
      }

      // Logs
      const logBox = document.getElementById('consoleLogs');
      const isAtBottom = logBox.scrollHeight - logBox.clientHeight <= logBox.scrollTop + 50;
      logBox.innerHTML = (data.logs || []).map(l => {
        return '<div class="log-line">' +
          '<span class="log-time">' + l.time + '</span>' +
          '<span class="log-tag tag-' + l.type + '">' + l.type + '</span>' +
          '<span>' + escapeHtml(l.message) + '</span>' +
        '</div>';
      }).join('');
      if (isAtBottom) logBox.scrollTop = logBox.scrollHeight;
    }

    function escapeHtml(str) {
      return (str || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    let authToken = localStorage.getItem('mbot_auth') || '';
    let pollInterval = null;

    function getAuthHeaders() {
      const h = { 'Content-Type': 'application/json' };
      if (authToken) h['Authorization'] = 'Bearer ' + authToken;
      return h;
    }

    function togglePasswordVisibility() {
      const inp = document.getElementById('adminPasswordInput');
      inp.type = inp.type === 'password' ? 'text' : 'password';
    }

    async function handleLogin(e) {
      if (e) e.preventDefault();
      const pass = document.getElementById('adminPasswordInput').value;
      const errBox = document.getElementById('loginError');
      errBox.style.display = 'none';

      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pass })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          authToken = data.token;
          localStorage.setItem('mbot_auth', data.token);
          showDashboard();
        } else {
          errBox.style.display = 'block';
          errBox.textContent = data.error || 'Mật khẩu không chính xác!';
        }
      } catch (err) {
        errBox.style.display = 'block';
        errBox.textContent = 'Lỗi kết nối tới máy chủ!';
      }
    }

    async function handleLogout() {
      localStorage.removeItem('mbot_auth');
      authToken = '';
      if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
      await fetch('/api/logout', { method: 'POST', headers: getAuthHeaders() }).catch(() => {});
      document.getElementById('mainDashboard').style.display = 'none';
      document.getElementById('loginOverlay').style.display = 'flex';
      document.getElementById('adminPasswordInput').value = '';
    }

    function showDashboard() {
      document.getElementById('loginOverlay').style.display = 'none';
      document.getElementById('mainDashboard').style.display = 'flex';
      fetchStatus();
      if (!pollInterval) pollInterval = setInterval(fetchStatus, 3000);
    }

    async function fetchStatus() {
      try {
        const res = await fetch('/api/status', {
          headers: getAuthHeaders()
        });
        if (res.status === 401) {
          handleLogout();
          return;
        }
        const data = await res.json();
        updateUI(data);
      } catch (e) {
        console.error("Lỗi fetch status", e);
      }
    }

    async function setMode(mode) {
      await fetch('/api/settings', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ mode })
      });
      fetchStatus();
    }

    async function toggleSetting(key, val) {
      await fetch('/api/settings', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ [key]: val })
      });
      fetchStatus();
    }

    async function saveToken() {
      const token = document.getElementById('tokenInput').value.trim();
      if (!token) return alert('Vui lòng nhập Token');
      const res = await fetch('/api/token', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ token })
      });
      if (res.status === 401) return handleLogout();
      alert('Đã gửi token! Đang kết nối Discord...');
      fetchStatus();
    }

    // Kiểm tra phiên đăng nhập đã lưu
    if (authToken) {
      fetch('/api/status', { headers: getAuthHeaders() }).then(res => {
        if (res.ok) {
          showDashboard();
        } else {
          document.getElementById('loginOverlay').style.display = 'flex';
        }
      }).catch(() => {
        document.getElementById('loginOverlay').style.display = 'flex';
      });
    } else {
      document.getElementById('loginOverlay').style.display = 'flex';
    }
  </script>
</body>
</html>`;
}

// Format Uptime
function getUptimeString() {
  const diffSec = Math.floor((Date.now() - startTime) / 1000);
  const h = Math.floor(diffSec / 3600);
  const m = Math.floor((diffSec % 3600) / 60);
  const s = diffSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

function parseJsonBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

// ═══════════════════════════════════════════════════════
// 13. KHỞI TẠO HTTP SERVER VỚI API & BẢO MẬT MẬT KHẨU
// ═══════════════════════════════════════════════════════
const server = http.createServer(async (req, res) => {
  const url = req.url.split("?")[0];

  // 1. Health check cho Render và Uptime Monitors (Luôn Public)
  if (url === "/health" || url === "/ping") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ status: "healthy", botReady: botIsReady, mode: currentMode }));
  }

  // 2. API Đăng nhập Mật Khẩu Quản Trị (Public)
  if (url === "/api/login" && req.method === "POST") {
    const payload = await parseJsonBody(req);
    const inputPass = String(payload.password || "");
    // So sánh mật khẩu (chấp nhận cả bản gốc và bản đã gọt khoảng trắng)
    if (inputPass === ADMIN_PASSWORD || inputPass.trim() === ADMIN_PASSWORD.trim()) {
      const token = generateAuthToken();
      activeSessions.add(token);
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Set-Cookie": `mbot_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
      });
      return res.end(JSON.stringify({ success: true, token }));
    }
    res.writeHead(401, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ success: false, error: "Mật khẩu không chính xác!" }));
  }

  // 3. API Đăng xuất (Public)
  if (url === "/api/logout" && req.method === "POST") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Set-Cookie": "mbot_session=; Path=/; HttpOnly; Max-Age=0",
    });
    return res.end(JSON.stringify({ success: true }));
  }

  // 4. BẢO VỆ TẤT CẢ CÁC API CÒN LẠI (Yêu cầu mật khẩu)
  if (url.startsWith("/api/")) {
    if (!verifyAuth(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Unauthorized", needLogin: true }));
    }
  }

  // 5. API Status (Dữ liệu thời gian thực cho Web UI)
  if (url === "/api/status" && req.method === "GET") {
    const totalAllTime = Object.values(progress).reduce((acc, cur) => acc + (cur.total_reacted || 0), 0);
    const profile = PROFILES[currentMode] || PROFILES.normal;

    const data = {
      botReady: botIsReady,
      hasToken: Boolean(discordToken),
      userTag: botIsReady && client.user ? client.user.tag : "Chưa kết nối",
      mode: currentMode,
      modeDesc: profile.label,
      uptime: getUptimeString(),
      controls,
      sessionReacts: stats.totalReactsThisSession,
      totalAllTimeReacts: totalAllTime,
      rateLimitHits: stats.rateLimitHits,
      current429Streak: stats.current429Streak,
      boss: getBossStatus(),
      activeWorkers: stats.activeWorkerChannels,
      progress,
      logs: logBuffer,
    };

    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify(data));
  }

  // 6. API Thay đổi cài đặt & Chế độ
  if (url === "/api/settings" && req.method === "POST") {
    const payload = await parseJsonBody(req);
    if (payload.mode && PROFILES[payload.mode]) {
      currentMode = payload.mode;
      addLog("MODE", `Chuyển sang chế độ: ${currentMode.toUpperCase()} (${PROFILES[currentMode].label})`);
    }
    if (typeof payload.autoReact === "boolean") controls.autoReact = payload.autoReact;
    if (typeof payload.spamEmoji === "boolean") controls.spamEmoji = payload.spamEmoji;
    if (typeof payload.autoBoss === "boolean") controls.autoBoss = payload.autoBoss;

    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ success: true, mode: currentMode, controls }));
  }

  // 7. API Cài Token từ UI
  if (url === "/api/token" && req.method === "POST") {
    const payload = await parseJsonBody(req);
    if (payload.token) {
      tryLogin(payload.token, "Giao diện Web UI");
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ success: true }));
    }
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Token rỗng" }));
  }

  // 8. Trang chủ Web UI (Chứa màn hình Login + Dashboard)
  if (url === "/" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(renderHtml());
  }

  // Default 404
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

server.listen(PORT, "0.0.0.0", () => {
  addLog("READY", `Web Server & UI đang lắng nghe tại cổng ${PORT} (0.0.0.0:${PORT})`);
  addLog("READY", `Chế độ khởi động mặc định: ${currentMode.toUpperCase()}`);
  
  // Kích hoạt Render Keep-alive
  startRenderKeepAlive();

  // Tự động tìm và đăng nhập Token từ các biến môi trường phổ biến
  const envResult = detectEnvironmentToken();
  if (envResult.key) {
    addLog("AUTH", `Đã phát hiện biến môi trường: "${envResult.key}"`);
    tryLogin(envResult.raw, `Biến ${envResult.key}`);
  } else {
    addLog("AUTH", "Chưa tìm thấy biến Token (DISCORD_TOKEN, TOKEN...) trong môi trường. Hãy nhập trên Web UI hoặc cài đặt trong Render Dashboard.");
  }
});

// ═══════════════════════════════════════════════════════
// 14. GRACEFUL SHUTDOWN
// ═══════════════════════════════════════════════════════
async function shutdown(signal) {
  addLog("SHUTDOWN", `Nhận tín hiệu ${signal}. Đang lưu tiến trình và thoát...`);
  await flushSave();
  if (botIsReady) client.destroy();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
