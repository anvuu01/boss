import discord
from discord.ext import commands, tasks
import os
import asyncio
import random
from datetime import datetime, timedelta
from flask import Flask
from threading import Thread

# Web server ảo cho UptimeRobot
app = Flask(__name__)
@app.route('/')
def home():
    return "Bot đang chạy!"

def run_server():
    app.run(host="0.0.0.0", port=8080)

bot = commands.Bot(command_prefix="!", self_bot=True)

# ID Kênh và Server (Lấy từ file spam.py)
CHANNEL_ID = 1381302690335952988
GUILD_ID = 1194106864582004849

def is_boss_time():
    now = datetime.utcnow() + timedelta(hours=7)
    if now.hour == 11 and now.minute >= 55: return True
    if now.hour == 12 and now.minute <= 20: return True
    if now.hour == 19 and 10 <= now.minute <= 35: return True
    return False

# Vòng lặp spam emoji mỗi 60 giây
@tasks.loop(seconds=60)
async def spam_emoji_task():
    try:
        guild = bot.get_guild(GUILD_ID)
        if not guild: return
        
        channel = bot.get_channel(CHANNEL_ID)
        if not channel: return
            
        if guild.emojis:
            emoji = random.choice(guild.emojis)
            await channel.send(str(emoji))
            print(f"Đã spam emoji: {emoji} lúc {datetime.utcnow() + timedelta(hours=7)}")
    except Exception as e:
        print(f"Lỗi spam: {e}")

@bot.event
async def on_ready():
    print(f"Đã log: {bot.user}")
    # Khởi động vòng lặp spam khi bot online
    if not spam_emoji_task.is_running():
        spam_emoji_task.start()

@bot.event
async def on_message(message):
    if not is_boss_time():
        return

    if message.author.bot and message.components:
        for row in message.components:
            for component in getattr(row, 'children', []):
                label = getattr(component, 'label', '') or ''
                emoji_name = component.emoji.name if getattr(component, 'emoji', None) else ''
                
                if "Đánh Boss" in label or "⚔️" in emoji_name:
                    try:
                        await asyncio.sleep(random.uniform(2.5, 6.0))
                        await component.click()
                        print(f"Đã đánh boss lúc {datetime.utcnow() + timedelta(hours=7)}")
                    except Exception as e:
                        print(f"Lỗi: {e}")
                        
    await bot.process_commands(message)

Thread(target=run_server).start()
bot.run(os.environ.get("DISCORD_TOKEN"))
