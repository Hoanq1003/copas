# 📋 CoPas — Clipboard Manager

**CoPas** là ứng dụng quản lý clipboard cho **Windows** và **macOS**, được xây dựng bằng **Tauri v2 + Rust**. Copy và dán hàng loạt, lưu trữ vĩnh viễn lịch sử clipboard.

## ✨ Tính năng

- 📋 **Tự động lưu** mọi nội dung bạn copy (văn bản + hình ảnh)
- 🖱 **Click để dán** — click mục bất kỳ → tự dán vào app đang mở
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
| `Cmd+Shift+V` / `Ctrl+Shift+V` | Mở / Ẩn CoPas |
| `Click` | Dán mục vào app đích |
| `Ctrl+Click` | Chọn nhiều mục |
| `Enter` | Dán mục đang focus / đã chọn |
| `Double Click` | Copy (không dán) |
| `Ctrl+A` | Chọn tất cả |
| `Ctrl+Shift+C` | Copy hàng loạt |
| `Delete` | Xóa mục đã chọn |
| `Ctrl+T` | Tạo thẻ mới |
| `Ctrl+,` | Cài đặt |
| `Escape` | Ẩn CoPas |

## 📦 Cài đặt

Tải bản mới nhất từ [**Releases**](https://github.com/Hoanq1003/copas/releases/latest).

### 🍎 macOS

1. Tải file `.dmg` phù hợp:
   - **Apple Silicon** (M1/M2/M3/M4): `CoPas_x.x.x_aarch64.dmg`
   - **Intel**: `CoPas_x.x.x_x64.dmg`
2. Mở file `.dmg` → kéo **CoPas** vào thư mục **Applications**
3. Mở CoPas từ Applications

> ⚠️ **Nếu gặp lỗi "is damaged" hoặc "can't be opened":**
> Mở **Terminal** và chạy lệnh sau, rồi mở lại CoPas:
> ```bash
> xattr -cr /Applications/CoPas.app
> ```
> Lỗi này xảy ra vì app chưa có chứng chỉ Apple Developer ($99/năm). Lệnh trên xóa cờ quarantine của macOS.

### 🪟 Windows

1. Tải file `CoPas_x.x.x_x64-setup.exe`
2. Chạy file cài đặt → làm theo hướng dẫn
3. Mở CoPas từ Start Menu hoặc Desktop

> 💡 Nếu Windows SmartScreen cảnh báo, nhấn **More info** → **Run anyway**.

## 🚀 Cách sử dụng

1. **Copy** nội dung từ bất kỳ đâu — CoPas tự động lưu
2. Nhấn **Cmd+Shift+V** (Mac) hoặc **Ctrl+Shift+V** (Windows) — popup xuất hiện
3. **Click** mục cần dán → CoPas tự dán và ẩn!

### Dán nhiều mục
1. **Ctrl+Click** chọn các mục
2. Nhấn **Enter** → tất cả được dán!

## 🛠 Build từ source

```bash
git clone https://github.com/Hoanq1003/copas.git
cd copas
npm install
npm run tauri dev      # Chạy dev
npm run tauri build    # Build installer
```

### Yêu cầu
- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) >= 18

## 📝 License

MIT
