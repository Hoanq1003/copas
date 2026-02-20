# 📋 CoPas — Clipboard Manager

**CoPas** là ứng dụng quản lý clipboard cho **Windows** và **macOS**, được xây dựng bằng **Tauri v2 + Rust**. Copy và dán hàng loạt, lưu trữ vĩnh viễn lịch sử clipboard.

## ✨ Tính năng

- 📋 **Tự động lưu** mọi nội dung bạn copy (văn bản + hình ảnh)
- 🗂 **Hệ thống thẻ** — phân loại nội dung theo nhóm tùy ý
- 🏷 **Đặt tên mục** — gắn nhãn dễ nhận biết
- 📌 **Ghim** nội dung quan trọng
- 🔍 **Tìm kiếm** theo từ khóa
- ☀️🌙 **Light/Dark theme**
- 💾 **Lưu trữ vĩnh viễn** — không mất khi tắt app
- ⚡ **Siêu nhẹ** — sử dụng Tauri + Rust, chỉ ~3MB

## ⌨️ Phím tắt

| Phím tắt | Hành động |
|----------|-----------|
| `Ctrl+Shift+V` (hoặc `Cmd+Shift+V`) | Mở / Ẩn CoPas |
| `Ctrl+Click` | Chọn từng mục |
| `Ctrl+A` | Chọn tất cả |
| `Ctrl+Shift+C` | Copy hàng loạt |
| `↑` / `↓` | Di chuyển giữa mục |
| `Enter` | Copy mục đang focus |
| `Delete` | Xóa mục đã chọn |
| `Ctrl+T` | Tạo thẻ mới |
| `Ctrl+,` | Cài đặt |
| `F1` | Hướng dẫn |

## 🚀 Cách dán hàng loạt (3 bước)

1. **Copy** nội dung từ bất kỳ đâu  
2. **Ctrl+Click** chọn các mục, hoặc **Ctrl+A** chọn tất cả  
3. **Ctrl+Shift+C** → qua app đích → **Ctrl+V** dán!

## 📦 Cài đặt

### macOS (Apple Silicon)
1. Tải file `.dmg` từ [**Releases**](https://github.com/Hoanq1003/copas/releases/latest)
2. Mở và kéo CoPas vào Applications
3. **Nếu báo "is damaged"**, mở Terminal và chạy:
```bash
xattr -cr /Applications/CoPas.app
```
4. Mở lại CoPas — chạy bình thường!

> ⚠️ Lỗi "damaged" xảy ra vì app chưa có chứng chỉ Apple Developer. Lệnh trên xóa đánh dấu "quarantine" từ macOS.

### Windows
> 🔜 Sắp có — đang phát triển bản Windows.

## 🛠 Build từ source

```bash
# Clone repo
git clone https://github.com/Hoanq1003/copas.git
cd copas

# Cài dependencies
npm install

# Chạy dev
npm run tauri dev

# Build installer
npm run tauri build
```

### Yêu cầu hệ thống để build
- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) >= 18
- Tauri CLI: `npm install -g @tauri-apps/cli`

## 📝 License

MIT
