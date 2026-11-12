# unzi (Node.js + MySQL)

Bot Discord đo hoạt động server (chỉ metadata, không đọc nội dung), tính điểm **Hoạt động / Đón người mới / Tổng hợp / Độ tin cậy**, kèm bảng xếp hạng công khai, web dashboard và admin panel.

## Chạy
1. MySQL 8: tạo database + user, `cp .env.example .env` rồi điền (nhớ `PSEUDONYM_SECRET` và `ADMIN_IDS` = Discord user id của bạn).
2. Discord Developer Portal: bật **Server Members Intent**, thêm redirect OAuth2 `BASE_URL/auth/callback`. Không cần Message Content Intent.
3. `npm install && npm run db:init` (chạy lại được; tự thêm cột/bảng mới cho DB cũ)
4. Hai tiến trình: `npm run bot` và `npm run web`.

## Luồng sử dụng
- **Thêm bot** (nút trên web, quyền View Channel + Send Messages) → unzi **tự tham gia xếp hạng ngay**, tạo điểm/biểu đồ đầu tiên sau tối đa 24 giờ và gửi thông báo minh bạch. Không có tùy chọn theo dõi/ngừng theo dõi trong dashboard; muốn rời xếp hạng phải kick bot khỏi server.
- **Đăng nhập Discord** → Dashboard liệt kê server bạn có quyền Manage Server, chia "đã có bot" / "chưa có bot" (nút thêm bot). Bấm server đã có bot để mở hồ sơ: 3 chỉ số chính, biểu đồ cột nhắn tin theo giờ, 2 biểu đồ đường tương tác (bật/tắt đường, 7/30/90 ngày, chuẩn hóa, tooltip), biểu đồ lục giác (so với trung bình các server khi có ≥3 server), gợi ý cải thiện, phân bố kênh, sức khỏe dữ liệu, cấu hình, khiếu nại.
- **Admin** (`#/admin`, chỉ user trong `ADMIN_IDS`): Tổng quan hệ thống, danh sách lớn server (tìm/lọc, ẩn khỏi BXH, khóa server → bot tự rời, tính lại điểm, cộng/trừ điểm có lý do, ghi chú, sửa mô tả/link mời), Bảng xếp hạng đầy đủ, Khiếu nại, Nhật ký thao tác, Công tắc tính năng.
- **Công tắc tính năng**: admin có thể bật/tắt bảng xếp hạng, hồ sơ công khai và percentile. Mặc định unzi hiển thị bảng xếp hạng công khai.

## Cấu trúc
`src/bot.js` thu event + lệnh `/ci` · `src/scoring.js` công thức (đổi trọng số thì đổi `VERSION`) · `src/jobs.js` tính điểm mỗi `JOB_INTERVAL_MIN` phút · `src/server.js` OAuth + API · `public/` giao diện (`app.js`, `admin.js`, `style.css`).

## Quyết định thiết kế cần biết
- Không phân loại server: percentile và đường trung bình tính trên tất cả server.
- Admin có thể cộng/trừ tối đa 25 điểm với lý do bắt buộc; điều chỉnh được ghi vào nhật ký và cộng vào điểm tổng hợp.
- Ngưỡng chuẩn hóa trong `scoring.js` là giá trị khởi điểm, cần hiệu chỉnh bằng server thật.
- Điểm 30 ngày tính từ bảng `events` (giữ `EVENT_TTL_DAYS`=35 ngày). Server rất lớn cần chuyển sang aggregate theo giờ.
- Biểu đồ theo giờ quy đổi sang múi giờ máy người xem. Session đăng nhập lưu trong RAM (restart là đăng nhập lại).
- Reply tắt ping mà bot không còn cache tin gốc thì không xác định được người nhận.

## Chưa làm
Bayesian shrinkage, so sánh hai server, Partnership Finder, export báo cáo, voice/thread metric, nhóm chỉ số C–E, giới hạn tần suất API.
