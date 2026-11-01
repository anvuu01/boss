import os
import subprocess
import sys

# File bridge: Giúp Render tự động chạy code Node.js ngay cả khi trước đó bạn chọn môi trường Python
if __name__ == "__main__":
    if not os.path.exists("node_modules"):
        print("[Bridge] Auto-installing npm dependencies on Render...")
        subprocess.run(["npm", "install"], check=True)
    
    print("[Bridge] Launching Node.js bot with Web UI...")
    # Forward exit code từ node bot.js
    exit_code = subprocess.call(["node", "bot.js"])
    sys.exit(exit_code)
