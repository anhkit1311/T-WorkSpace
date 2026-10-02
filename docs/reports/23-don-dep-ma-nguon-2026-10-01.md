# Dọn dẹp mã nguồn — 01/10/2026

## Phạm vi và kết quả quét

Quét frontend, backend, shared package, test, scripts, cấu hình và tài liệu; đối chiếu SHA-256, import/export/dynamic import và CSS import. Kiểm tra riêng các asset public và command trong package/CI/Docker.

Không tính dependency của bên thứ ba, PostgreSQL data, cache và output build là mã nguồn độc lập. `packages/shared/dist` và `dist/api`, `dist/web` là output đang phục vụ package/runtime; chúng được build lại trong đợt kiểm chứng, không xóa như code trùng.

Trong vùng mã nguồn chính, không phát hiện file code trùng hoàn toàn hoặc module không thể truy cập qua entrypoint/import graph. Tất cả module frontend/backend đều có liên kết sử dụng. Đây là kết quả phân tích tĩnh theo cấu trúc hiện tại, không phải chứng minh mọi nhánh code đều được chạy.

## Đã dọn

1. Xóa thư mục `.review-tools` khỏi cây làm việc: **342 file, 108.827.434 byte**. Trong đó có **128 file code**, gồm **80 bản trùng hoàn toàn với source chính** và **48 file code lịch sử/công cụ một lần**. Các bản baseline và snapshot của giao diện không được ứng dụng hiện tại import.
2. Trước khi xóa, lưu các bản sao source lịch sử, script và bằng chứng vào `backups/source-cleanup-20261001-211438.zip`; kiểm tra số entry, kích thước và SHA-256 của từng entry. Có 260 entry: 258 file lịch sử/bằng chứng và 2 stylesheet gốc. Không đưa dependency ffmpeg và npm cache có thể tải lại vào archive.
3. Xóa **45 selector CSS không còn được markup tham chiếu**, thuộc các nhóm `preview-*`, `product-preview`, `floating-note`, `logo-cloud`, `stats-row`: 44 selector trong `styles.css` và 1 trong `workspace-theme.css`. Giảm **5.907 byte** source CSS. Kiểm tra các class trong TypeScript/TSX/HTML trước khi xóa; giữ nguyên class preview của meeting.
4. Đổi tham số payload không sử dụng của handler `leave_meeting` thành `_data`, giữ nguyên vị trí callback và giao thức socket.
5. Thêm `.review-tools/` vào `.gitignore`. Loại công cụ tạm, cache Vite, archive backup và dump khỏi Docker build context để chúng không bị gửi vào build.
6. Xóa các script kiểm toán/dọn dẹp tạm do lượt này tạo sau khi sử dụng.

Archive khoảng 6,63 MB; dung lượng giải phóng sau khi giữ archive/manifest khoảng **102 MB** (đơn vị thập phân; chưa tính thay đổi output build).

## Những phần giữ lại có lý do

- Migration 001–020: có thứ tự và checksum, cần cho cài mới và các DB đã áp dụng migration.
- Test và helper: phục vụ kiểm chứng nghiệp vụ, quyền, media và nhiều API instance.
- Script benchmark/schema/restore/bundle: được tài liệu hoặc command dự án sử dụng; không phải source ứng dụng nhưng vẫn có mục đích.
- Tài liệu, báo cáo và dữ liệu đo: bằng chứng cho đồ án và các đợt rà soát.
- Hai asset public hiện tại: favicon/avatar và ảnh nền orbital đều được tham chiếu.
- `.env`, PostgreSQL data, dependency đang cài và cache của dev server: không nằm trong nhóm code dư được xóa.
- CSS còn lại: giữ các rule có vai trò cascade, responsive hoặc class sinh động; không xóa chỉ vì selector xuất hiện nhiều lần.

## Khôi phục khi cần

Archive: `backups/source-cleanup-20261001-211438.zip`.
Manifest: `backups/source-cleanup-20261001-211438.json`.

Giải nén vào một thư mục riêng để xem bản lịch sử. Nếu muốn khôi phục đúng hai stylesheet trước dọn, lấy `apps/web/src/app/styles/styles.css` và `apps/web/src/app/styles/workspace-theme.css` trong archive. Các script lịch sử có thể phụ thuộc cây source cũ; kiểm tra trước khi chạy.

## Kiểm chứng

Baseline: typecheck/lint/unit tests qua; các bài tích hợp DB được test mặc định skip theo cấu hình. Kiểm tra TypeScript với `noUnusedLocals`/`noUnusedParameters` cho frontend qua; backend phát hiện duy nhất payload không dùng và đã xử lý.

Kiểm tra sau dọn:

- `npm run typecheck`: qua.
- `npm run lint`: qua.
- `npm test`: qua; 8 bài tích hợp API được lệnh mặc định skip theo cấu hình.
- `npm run build`: qua shared, API và web.
- `npm run test:sfu`: **9 bài qua, 0 fail, 0 skip**. Bao gồm conversations, hai API process, governance, quyền/history/socket, meeting sessions, file signature, DB/S3 protocol với môi trường test, Kanban và thay worker lỗi.
- Kiểm tra TypeScript backend với `noUnusedLocals`/`noUnusedParameters`: qua sau đổi tên payload không dùng.

Các bài SFU kiểm tra signaling/worker, không được diễn giải thành kiểm chứng audio/video thật trên trình duyệt. Lần này không chạy lại QA thị giác; CSS bị xóa đã được đối chiếu không có class sử dụng trong markup hiện tại.

Không bổ sung chức năng hay thay đổi hướng thiết kế trong lần dọn này. Các thay đổi CSS chỉ loại selector của component đã không còn tồn tại.
