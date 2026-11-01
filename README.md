# M-Bot (Discord Selfbot with Web Dashboard)

Bot tự động quét reaction Discord, spam emoji chu kỳ và săn Boss tự động, tích hợp sẵn **Web UI Dashboard** hiện đại và cấu hình chuẩn 1-click cho **Render.com**.

---

## 🚀 Tính Năng Chính

- **Web UI Quản Lý Trực Quan**: 
  - Xem trạng thái Bot, Tag Discord, Uptime theo thời gian thực.
  - Chuyển đổi linh hoạt giữa 3 chế độ (**Safe**, **Normal**, **Fast**) ngay trên trình duyệt mà không cần restart.
  - Công tắc bật/tắt nhanh từng tính năng: Auto React, Auto Spam Emoji, Auto Đánh Boss.
  - Bảng thống kê chi tiết số lượt đã react từng kênh, ID bài viết cuối cùng, số lần gặp 429 rate limit.
  - Bộ xem nhật ký (Console Logs) trực tiếp trên Web.
- **Tối Ưu 100% Cho Render**:
  - Tự động nhận diện cổng `process.env.PORT` của Render.
  - Đã tích hợp sẵn file Blueprint `render.yaml` — Render tự động nhận cấu hình Node.js 100%, không bị nhận nhầm sang Python.
  - Endpoint `/health` chuẩn cho Render Health Check.
  - Cơ chế **Self Keep-Alive** tự động ping mỗi 10 phút chống Render Free Tier vào trạng thái Sleep.
  - Khởi động an toàn: Nếu chưa cài `DISCORD_TOKEN`, container vẫn chạy để hiển thị Web UI cho bạn nhập Token, không bị văng lỗi crash loop.

---

## ⚙️ Các Chế Độ Tốc Độ

| Chế độ | Kênh song song | Delay mỗi react | Cooldown phụ | Đánh giá |
|:---:|:---:|:---:|:---:|:---|
| **SAFE** | 2 kênh | 800 - 1500ms | +300ms | An toàn tuyệt đối, tránh rate limit |
| **NORMAL (Mặc định)** | 3 kênh | 500 - 900ms | +150ms | Tốc độ tối ưu và cân bằng |
| **FAST** | 4 kênh | 350 - 600ms | 0ms | Tốc độ cao nhất, có thể gặp 429 |

---

## 🌐 Triển Khai Lên Render (Không Cần Chỉnh Sửa Phức Tạp)

Vì dự án đã có sẵn file `render.yaml` và `package.json`, bạn chỉ cần:

1. Đẩy code lên GitHub:
   ```bash
   git add .
   git commit -m "Deploy: Node.js bot with Web UI for Render"
   git push -u origin main
   ```
2. Truy cập [dashboard.render.com](https://dashboard.render.com):
   - Chọn **New +** -> **Web Service** (hoặc **Blueprint**).
   - Kết nối tới repository `anvuu01/boss`.
   - Render sẽ tự động đọc `render.yaml`:
     - Runtime: `Node`
     - Build Command: `npm install`
     - Start Command: `npm start`
     - Health Check Path: `/health`
3. Trong tab **Environment Variables** trên Render, thêm 1 biến:
   - `DISCORD_TOKEN`: `<Token tài khoản Discord của bạn>`
   *(Nếu chưa kịp thêm trên Render, bạn vẫn có thể mở link Web của Render và nhập Token trực tiếp qua giao diện!)*

---

## 💻 Chạy Thử Ở Local (Tuỳ Chọn)

```bash
# Cài đặt thư viện
npm install

# Đặt biến môi trường (PowerShell Windows)
$env:DISCORD_TOKEN="token_cua_ban"

# Khởi chạy bot
npm start
```
Mở trình duyệt truy cập: `http://localhost:8080`
