# Cấu trúc dự án — 01/10/2026

## Nguyên tắc

Giữ monorepo gồm frontend, API và hợp đồng dùng chung. Source tổ chức theo chức năng nghiệp vụ; tách điều phối ứng dụng và hạ tầng. Component/CSS/API chuyên biệt của một chức năng nằm cạnh nhau.

Giữ tên component, giao thức và thứ tự CSS; import trỏ trực tiếp tới module thật.

## Cây thư mục

```text
DoAnTotNghiep/
├── apps/web/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── app/
│   │   │   ├── App.tsx
│   │   │   ├── navigation.ts
│   │   │   ├── types.ts
│   │   │   ├── providers/
│   │   │   ├── layout/
│   │   │   └── styles/
│   │   ├── features/
│   │   │   ├── landing/
│   │   │   ├── auth/
│   │   │   ├── workspaces/
│   │   │   ├── chat/
│   │   │   ├── meetings/
│   │   │   │   └── webrtc/
│   │   │   ├── tasks/
│   │   │   ├── notifications/
│   │   │   ├── profile/
│   │   │   └── search/
│   │   └── shared/
│   │       ├── ui/
│   │       ├── hooks/
│   │       └── lib/
│   ├── public/
│   └── test/
├── services/api/
│   ├── src/
│   │   ├── server.ts
│   │   ├── config/
│   │   ├── modules/
│   │   │   ├── auth/
│   │   │   ├── workspaces/
│   │   │   ├── chat/
│   │   │   ├── tasks/
│   │   │   ├── files/
│   │   │   ├── profiles/
│   │   │   └── meetings/
│   │   │       └── media/
│   │   ├── infrastructure/
│   │   │   ├── database/
│   │   │   ├── email/
│   │   │   ├── realtime/
│   │   │   └── operations/
│   │   ├── shared/http/
│   │   └── scripts/migrate.ts
│   ├── migrations/
│   └── test/
├── packages/shared/
├── scripts/
│   ├── benchmarks/
│   ├── database/
│   └── testing/
├── infra/
├── design-system/
├── docs/
│   ├── analysis/
│   ├── planning/
│   ├── modules/
│   ├── guides/
│   ├── reports/
│   ├── changelog/
│   ├── benchmarks/
│   └── evidence/
└── backups/
```

## Đặt file mới ở đâu

- Frontend: page/component/API/CSS chuyên biệt vào `features/<module>`; chỉ đưa vào `shared` khi dùng chung.
- Providers và điều hướng thuộc `app`. Global CSS thuộc `app/styles`.
- Backend: route/service nghiệp vụ vào `modules/<module>`; DB/email/socket lifecycle/maintenance vào `infrastructure`.
- `shared/http` chứa context, error, utils, rate limit và OpenAPI.
- Types/giao thức chung nằm trong `packages/shared`; runtime vẫn validate đầu vào.
- Tests giữ vị trí `apps/web/test` và `services/api/test` theo runner.
- Scripts chia `benchmarks`, `database`, `testing`; chạy từ root qua npm command hoặc đường dẫn trong README.
- Tài liệu vào nhóm thích hợp, thêm link ở [mục lục](../README.md).

Một số API client trong feature chat vẫn cung cấp hàm đọc workspace/kênh cho feature khác; lần này sắp xếp file, chưa tách lại hợp đồng nghiệp vụ.

## Runtime và build

- Web entry vẫn là `src/main.tsx`; API entry vẫn là `dist/api/server.js`.
- Shared build tới `packages/shared/dist`.
- API build tạo cấu trúc mới dưới `dist/api/modules`, `infrastructure`, `shared`, `config`.
- `.env` đọc từ root cho cả source TypeScript và JS đã build; đường dẫn cập nhật theo vị trí mới.
- Migration runner/SQL giữ vị trí để local và Docker nạp migration đúng.
- Imports trong tests/benchmark, npm scripts và link tài liệu đã cập nhật.

## Khôi phục và kiểm chứng

Đã sao lưu 143 file trước sắp xếp vào `backups/structure-before-20261001.zip`. Bảng chuyển nằm ở `backups/structure-moves-20261001.json`: 120 file chuyển và 18 file tại chỗ cập nhật tham chiếu.

Typecheck, lint, unit tests và production build qua. `npm run test:sfu` qua 9 bài, không fail/skip: chat, nhiều API instance, quyền/quản trị, meeting sessions, storage, Kanban và worker recovery. Những bài SFU này không thay thế kiểm chứng RTP thật trên trình duyệt.

Đã kiểm tra đường dẫn import và liên kết tài liệu, không phát hiện tham chiếu hỏng. Đã xóa 76 file build ở vị trí cũ sau khi xác nhận có bản thay thế trong cấu trúc mới, rồi chạy lại tests thành công. `npm run db:migrate` xác nhận cả 20 migration đã được áp dụng, không thay đổi checksum.
