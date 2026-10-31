import discord
from discord.ext import commands, tasks
import os
import asyncio
import random
import json
from datetime import datetime, timedelta
from pathlib import Path
from flask import Flask
from threading import Thread

# === 1. CẤU HÌNH WEB SERVER (Cho UptimeRobot) ===
app = Flask(__name__)
@app.route('/')
def home(): return "Bot đang chạy 3 tác vụ ngầm!"
def run_server(): app.run(host="0.0.0.0", port=8080)

# === 2. KHỞI TẠO BOT ===
bot = commands.Bot(command_prefix="!", self_bot=True)

# === 3. CẤU HÌNH SPAM EMOJI ===
CHANNEL_ID = 1381302690335952988
GUILD_ID = 1194106864582004849

# === 4. CẤU HÌNH AUTO REACT ===
DELAY = 1.0  
MAX_MESSAGES_PER_CHANNEL = None
SKIP_BOT_MESSAGES = True
FULL_SCAN = False
CONCURRENT_CHANNELS = 4  
EMOJI_WHITELIST = []
EMOJI_BLACKLIST = []
CATEGORIES = [
    {
        "id": 1281146625435369472,
        "excluded_channels": [
            1229710841927045222, 1246901718143205437, 1516859270140792842,
            1516859246476787933, 1517099249257414777, 1196522451857842287,
            1232731962834161775, 1437860347032895518, 1390315019006251008,
            1281171567513960461, 1357284374684500159
        ]
    }
]

BASE_DIR = Path(__file__).parent
PROGRESS_FILE = BASE_DIR / "progress.json"
progress = {}

def load_json(path):
    if not path.exists(): return {}
    with open(path, "r", encoding="utf-8") as f: return json.load(f)

def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f: json.dump(data, f, indent=2)

# === 5. CÁC HÀM XỬ LÝ AUTO REACT ===
async def add_reaction_with_retry(message, emoji):
    while True:
        try:
            await message.add_reaction(emoji)
            return True
        except discord.HTTPException as e:
            if e.status == 429:
                retry_after = getattr(e, "retry_after", 2.0)
                sleep_time = float(retry_after) + 0.5
                print(f"[Rate Limit] Dừng {sleep_time:.2f}s...")
                await asyncio.sleep(sleep_time)
                continue
            return False
        except Exception:
            return False

async def process_channel(channel):
    key = str(channel.id)
    ch_progress = progress.get(key, {})
    last_id = ch_progress.get("last_reacted_id")
    reacted = ch_progress.get("total_reacted", 0)

    kwargs = {"limit": None if FULL_SCAN else MAX_MESSAGES_PER_CHANNEL}
    if not FULL_SCAN and last_id: kwargs["after"] = discord.Object(id=int(last_id))

    new_reacted = 0
    last_reacted_id = None

    async for message in channel.history(**kwargs):
        if SKIP_BOT_MESSAGES and message.author.bot: continue
        if not message.reactions: continue

        for reaction in message.reactions:
            if reaction.me: continue
            if await add_reaction_with_retry(message, reaction.emoji):
                new_reacted += 1
                reacted += 1
                last_reacted_id = message.id
                print(f"[{channel.name}] Đã react: {reacted} lần")
            await asyncio.sleep(DELAY)

    if last_reacted_id:
        progress[key] = {"name": channel.name, "last_reacted_id": str(last_reacted_id), "total_reacted": reacted}
        save_json(PROGRESS_FILE, progress)
    return new_reacted

async def process_category(cat_cfg, sem):
    category = bot.get_channel(cat_cfg["id"])
    if not category: return 0
    excluded = set(cat_cfg.get("excluded_channels", []))
    channels = [ch for ch in category.channels if isinstance(ch, discord.TextChannel) and ch.id not in excluded]

    async def work(ch):
        async with sem:
            try: return await process_channel(ch)
            except: return 0

    results = await asyncio.gather(*[work(ch) for ch in channels], return_exceptions=True)
    return sum(r for r in results if isinstance(r, int))

async def do_react_task():
    global progress
    await bot.wait_until_ready()
    while True:
        progress = load_json(PROGRESS_FILE)
        if CATEGORIES:
            sem = asyncio.Semaphore(CONCURRENT_CHANNELS)
            for cat in CATEGORIES: await process_category(cat, sem)
            save_json(PROGRESS_FILE, progress)
        await asyncio.sleep(60)

# === 6. VÒNG LẶP SPAM EMOJI ===
@tasks.loop(seconds=60)
async def spam_emoji_task():
    try:
        guild = bot.get_guild(GUILD_ID)
        channel = bot.get_channel(CHANNEL_ID)
        if guild and channel and guild.emojis:
            await channel.send(str(random.choice(guild.emojis)))
    except: pass

# === 7. SỰ KIỆN AUTO BOSS & ON_READY ===
def is_boss_time():
    now = datetime.utcnow() + timedelta(hours=7)
    if (now.hour == 11 and now.minute >= 55) or (now.hour == 12 and now.minute <= 20): return True
    if now.hour == 19 and 10 <= now.minute <= 35: return True
    return False

@bot.event
async def on_ready():
    # Ép trạng thái kết nối ngầm thành Tàng hình để không bị chặn thông báo điện thoại
    await bot.change_presence(status=discord.Status.invisible)
    print(f"Đã log: {bot.user}")
    
    if not spam_emoji_task.is_running(): 
        spam_emoji_task.start()
    asyncio.create_task(do_react_task())

@bot.event
async def on_message(message):
    if not is_boss_time(): return
    if message.author.bot and message.components:
        for row in message.components:
            for component in getattr(row, 'children', []):
                label = getattr(component, 'label', '') or ''
                emoji_name = component.emoji.name if getattr(component, 'emoji', None) else ''
                if "Đánh Boss" in label or "⚔️" in emoji_name:
                    try:
                        await asyncio.sleep(random.uniform(2.5, 6.0))
                        await component.click()
                    except: pass
    await bot.process_commands(message)

# === 8. CHẠY HỆ THỐNG ===
Thread(target=run_server).start()
bot.run(os.environ.get("DISCORD_TOKEN"))
