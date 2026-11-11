# Community Intelligence (Node.js + MySQL)

Bot Discord thu thập metadata hoạt động, tính điểm **Activity / Welcoming / Overall / Data Confidence**, web dashboard hiển thị leaderboard, hồ sơ công khai và dashboard cho admin. Bám theo `idea.md` (Phase 1 + phần cốt lõi Phase 2).

## Chạy
1. MySQL 8: tạo database + user, rồi `cp .env.example .env` và điền.
2. Discord Developer Portal: tạo application, bật **Server Members Intent** (privileged). Không cần Message Content Intent. Thêm redirect OAuth2: `BASE_URL/auth/callback`.
3. `npm install && npm run db:init`
4. Chạy hai tiến trình: `npm run bot` và `npm run web`.
5. Mở `BASE_URL`, đăng nhập, mời bot (quyền View Channel, không cần Administrator), vào `#/dashboard/<id>` chọn kênh, tick đồng ý, lưu.
6. (Tuỳ chọn) Điền `ADMIN_DISCORD_IDS` bằng các Discord user ID được phép mở `#/admin`. Admin có thể ẩn toàn bộ bảng xếp hạng, profile công khai hoặc trang phương pháp bằng feature flags.

## Cấu trúc
- `src/bot.js` – thu event (message/join/leave), băm user id (HMAC theo từng server), lệnh `/ci`.
- `src/scoring.js` – metric, chuẩn hóa, công thức `A`, `W`, `Overall`, confidence, trạng thái, anomaly. Trọng số nằm ở `WEIGHTS`, đổi công thức thì đổi `VERSION`.
- `src/jobs.js` – chạy mỗi `JOB_INTERVAL_MIN` phút (trong tiến trình web): daily metrics, snapshot, percentile, xóa event hết hạn.
- `src/server.js` – OAuth2, API public/admin. `public/index.html` – giao diện Pulse: dashboard cá nhân, profile server, biểu đồ hoạt động/radar, leaderboard và admin panel responsive.

## Quyết định thiết kế cần biết
- Ngưỡng chuẩn hóa (hàm `lin`/`logs` trong `scoring.js`) là **giá trị khởi điểm, chưa hiệu chỉnh**: cần chạy thử trên server thật rồi chỉnh.
- Điểm 30 ngày tính từ bảng `events` (giữ `EVENT_TTL_DAYS`=35 ngày). Server rất lớn (hàng triệu tin/30 ngày) cần chuyển sang aggregate theo giờ.
- Chào đón = người thật khác trả lời hoặc nhắc tới người mới trong 7 ngày. Reply tắt ping và không còn trong cache của bot thì không xác định được người nhận.
- Thời gian phản hồi đầu tiên đo từ lúc join. D7 = có hoạt động trong ngày 6–8.
- Giờ trong heatmap tính theo UTC. Session đăng nhập lưu trong RAM (restart là mất).

## Chưa làm
Bayesian shrinkage, so sánh server, Partnership Finder, export báo cáo, voice/thread metric, nhóm chỉ số C–E, giới hạn tần suất API, queue tách riêng (bot ghi thẳng MySQL qua `INSERT IGNORE` theo `event_id`).
