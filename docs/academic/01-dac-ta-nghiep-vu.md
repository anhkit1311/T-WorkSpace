# Đặc tả nghiệp vụ — Phân hệ Quản lý & Hướng dẫn Đồ án tốt nghiệp

> Định hướng đối tượng: **Khoa/Trường đại học** quản lý toàn bộ vòng đời đồ án tốt nghiệp:
> đăng ký đề tài → hướng dẫn → nộp bài → phản biện → hội đồng bảo vệ → chấm điểm → phúc khảo.
> Nền tảng cộng tác sẵn có (chat, Kanban, họp video, biên bản) trở thành **không gian làm việc của từng đồ án**.

Tên đề tài đề xuất: *Phát triển nền tảng cộng tác thời gian thực tích hợp hội nghị truyền hình đa điểm,
ứng dụng trong quản lý và hướng dẫn đồ án tốt nghiệp tại khoa/trường đại học.*

---

## 1. Tác nhân và phạm vi quyền

| Tác nhân | Xác định bởi | Phạm vi |
|---|---|---|
| Quản trị hệ thống | `academic_role_grants.role = 'system_admin'` | Toàn hệ thống: tạo khoa, cấp quyền giáo vụ/trưởng khoa |
| Giáo vụ khoa | `role = 'unit_admin'` theo khoa | Đợt đồ án, danh sách SV, mốc, hội đồng, lịch, công bố điểm |
| Trưởng khoa / Trưởng bộ môn | `role = 'unit_head'` | Duyệt đề tài, phân công phản biện, xử lý phúc khảo |
| Giảng viên | Có bản ghi `academic_staff` đang hoạt động | Đề xuất đề tài, hướng dẫn, phản biện, ngồi hội đồng |
| Sinh viên | Có `thesis_enrollments` trong đợt | Lập nhóm, đăng ký nguyện vọng, nộp bài, xác nhận nhật ký |

**Phân tách trách nhiệm (separation of duties):**

- Người đề xuất đề tài **không được tự duyệt** đề tài của mình.
- Giảng viên phản biện **khác** giảng viên hướng dẫn và đồng hướng dẫn.
- Theo chính sách đợt (`supervisor_in_committee = false`), GVHD **không** ngồi hội đồng chấm đồ án mình hướng dẫn.
- Chủ tịch hội đồng phải có học vị **Tiến sĩ trở lên**.
- Điểm do nhiều người chấm độc lập. Thư ký chỉ tổng hợp, không sửa điểm của thành viên khác.

## 2. Vòng đời đợt đồ án (`thesis_terms.status`)

```
draft → registration → execution → review → defense → grading → closed
```

- Chỉ đi tiến, mỗi lần một bước, do giáo vụ thực hiện. Mọi bước chuyển được ghi audit.
- `draft → registration` yêu cầu đủ điều kiện:
  - mốc thời gian hợp lệ;
  - trọng số ba thành phần điểm (GVHD, phản biện, hội đồng) cộng lại đúng 100;
  - rubric từng vai trò có tổng trọng số tiêu chí đúng 100;
  - có mốc đề cương (`proposal`) và mốc báo cáo cuối (`final`);
  - có ít nhất một sinh viên đủ điều kiện.
- Chính sách đánh giá (trọng số, quy mô nhóm, điều kiện GPA/tín chỉ, số buổi hướng dẫn) **bị khóa** khi đợt rời trạng thái nháp.
- **Nguồn thời gian duy nhất:** mọi điều kiện hạn chót đều so với đồng hồ của PostgreSQL (`now()` của giao dịch), không dùng đồng hồ máy chủ ứng dụng, để tránh sai lệch khi chạy nhiều node.
- `registration → execution`: các nhóm chưa được nhận đề tài bị đóng nguyện vọng (`expired`).
- `grading → closed`: mọi đồ án phải ở trạng thái kết thúc (`completed`, `failed`, `withdrawn`, `suspended`).

## 3. Sinh viên và điều kiện làm đồ án

- Giáo vụ nhập danh sách SV (mã SV, lớp, số tín chỉ tích lũy, GPA).
- Hệ thống **tự xét điều kiện**: `credits ≥ min_credits` và `gpa ≥ min_gpa` của đợt.
- Giáo vụ có thể ghi đè kết quả xét, nhưng **bắt buộc nhập lý do**. Thao tác ghi đè được lưu audit.
- Mã SV và tài khoản là duy nhất trong một đợt (ràng buộc trong DB).

## 4. Đề tài (`thesis_topics.status`)

```
                ┌────────── request_revision ──────────┐
                ▼                                      │
draft ──submit──► submitted ──approve──► approved ──close──► closed
  ▲                  │
  │                  └──reject──► rejected
awaiting_supervisor (đề tài do SV đề xuất, chờ GV nhận hướng dẫn)
```

- **GV đề xuất:** `draft → submitted`.
- **SV đề xuất:** `draft → awaiting_supervisor`. GV được chọn đồng ý thì chuyển `submitted`, từ chối thì quay về `draft`.
- Chỉ sửa nội dung ở `draft` / `revision_requested`. Có kiểm tra phiên bản (optimistic locking).
- Đề tài bị trả lại (`revision_requested`) sau khi sửa thì nộp lại về `submitted`.
- Trưởng khoa duyệt (khác người đề xuất). Mỗi quyết định lưu vào `thesis_topic_decisions`, append-only.
- Số SV tối đa của đề tài nằm trong `[min_group_size, max_group_size]` của đợt.
- **Kiểm tra trùng lặp tên/nội dung** với đề tài các đợt trước, bằng thuật toán tự xây (n-gram + Jaccard), xem mục 11.

## 5. Nhóm và đăng ký nguyện vọng

1. SV đủ điều kiện tạo nhóm và trở thành trưởng nhóm.
2. Trưởng nhóm mời thành viên. Người được mời chấp nhận hoặc từ chối.
3. **Mỗi SV chỉ thuộc tối đa một nhóm đang hoạt động trong một đợt.** Ràng buộc nằm ở DB qua *partial unique index*.
4. Nhóm đăng ký tối đa `max_preferences` nguyện vọng có thứ tự ưu tiên cho các đề tài `approved`.
5. Khi đang có nguyện vọng chờ duyệt, **thành phần nhóm bị khóa**.
6. GVHD của đề tài chấp nhận hoặc từ chối nguyện vọng. Khi chấp nhận, **trong một giao dịch có khóa dòng**, hệ thống:
   - kiểm tra sức chứa còn lại của đề tài (`max_students` trừ số SV đã nhận);
   - kiểm tra **định mức hướng dẫn** còn lại của GV trong đợt;
   - tạo đồ án (`thesis_projects`) và **tự sinh không gian cộng tác**: workspace riêng có GVHD và các SV, kênh chat, phòng họp;
   - hủy toàn bộ nguyện vọng còn lại của nhóm (`withdrawn`).
7. Hai GV chấp nhận cùng lúc cho một nhóm thì chỉ một giao dịch thành công. Điều này được kiểm chứng bằng test đồng thời.

## 6. Đồ án (`thesis_projects.status`): máy trạng thái kiểm soát ở DB

```
proposal ─► in_progress ─► final_submitted ─► defense_approved ─► under_review ─► review_passed ─► scheduled ─► defended ─► graded ─► completed
                 ▲                │                                   │                                                     │
                 └── (returned) ──┘                                   └► review_failed (không đủ ĐK bảo vệ)                 └► failed
mọi trạng thái chưa kết thúc ─► suspended (đình chỉ) | withdrawn (rút)
```

- Các cặp `(from, to)` hợp lệ nằm trong bảng `thesis_project_transitions`.
- **Trigger** từ chối mọi `UPDATE status` không có trong bảng. Vì vậy dù có lỗi ở tầng ứng dụng, DB vẫn không cho đồ án "nhảy cóc".
- Mọi bước chuyển được ghi vào `thesis_project_events`. Bảng này **chỉ được thêm**: trigger chặn UPDATE/DELETE.

Điều kiện nghiệp vụ, kiểm ở tầng dịch vụ:

| Chuyển | Ai | Điều kiện |
|---|---|---|
| proposal → in_progress | GVHD | Bản nộp mới nhất của mốc `proposal` đã được GVHD chấp nhận |
| in_progress → final_submitted | Hệ thống | Nhóm nộp bản ở mốc `final` |
| final_submitted → in_progress | GVHD | Trả bài kèm nhận xét |
| final_submitted → defense_approved | GVHD | Đủ `min_supervision_logs` nhật ký đã xác nhận hai phía; mọi mốc bắt buộc có bản được chấp nhận |
| defense_approved → under_review | Trưởng khoa (không phải GVHD của đồ án) | Phân công phản biện hợp lệ (khác GVHD/đồng HD) |
| under_review → review_passed / review_failed | GV phản biện | Nộp phiếu phản biện kèm đề nghị |
| review_passed → scheduled | Giáo vụ | Xếp vào ca bảo vệ hợp lệ (mục 8) |
| scheduled → defended | Thư ký HĐ | Ca bảo vệ đã bắt đầu |
| defended → graded | Thư ký HĐ | Đủ phiếu chấm, xử lý chênh lệch (mục 9) |
| graded → completed / failed | Giáo vụ | Công bố điểm theo `pass_score` |

## 7. Mốc nộp bài và nhật ký hướng dẫn

**Bản nộp (`thesis_submissions`)**

- Đánh số phiên bản tăng dần theo `(đồ án, mốc)`, lưu kèm SHA-256 của tệp.
- **Không sửa, không xóa** (trigger). Chỉ các trường nhận xét của GVHD được cập nhật, và chỉ một lần.
- Nộp trễ: chính sách `late_policy = reject` thì từ chối, `allow_flagged` thì nhận nhưng gắn cờ `is_late`.

**Nhật ký hướng dẫn (`thesis_supervision_logs`)**

- Có thể liên kết với phiên họp video có thật (`meeting_session_id`) của nền tảng.
- Nhật ký chỉ được tính khi **cả GVHD lẫn một SV trong nhóm xác nhận**. Sau khi đủ hai xác nhận thì bị khóa.

**Quyền đọc bản nộp:** giảng viên phản biện và thành viên hội đồng không thuộc không gian làm việc của nhóm. Vì vậy họ tải bản nộp qua `GET /api/academic/submissions/:id/file`, được phân quyền theo vai trò trong đồ án. Phản hồi kèm header `X-Content-SHA256`.

## 8. Hội đồng và lịch bảo vệ

**Hội đồng**

- Hội đồng có 3–5 thành viên, gồm đúng 1 chủ tịch (TS trở lên), 1 thư ký, còn lại là ủy viên. Điều kiện này được kiểm khi xác nhận hội đồng.

**Ca bảo vệ**

- Ca bảo vệ có khoảng thời gian `tstzrange`. Hai ràng buộc **EXCLUDE USING gist** đảm bảo:
  - một hội đồng không có hai ca chồng giờ;
  - **một giảng viên không bị xếp hai ca chồng giờ ở hai hội đồng khác nhau**, qua bảng `thesis_lecturer_bookings`.
- GVHD (và đồng HD) của đồ án không được ngồi hội đồng chấm đồ án đó.

**Xếp lịch tự động (thuật toán tự xây)**

- Đầu vào: các đồ án `review_passed`, các hội đồng đã xác nhận, độ dài ca.
- Cách xếp: tham lam có ràng buộc. Ưu tiên đồ án có ít hội đồng hợp lệ nhất (*most-constrained first*), sau đó cân bằng tải giữa các hội đồng.
- Kết quả trả về: phương án và danh sách đồ án không xếp được kèm lý do.

## 9. Chấm điểm

- Mỗi đợt có rubric riêng cho từng vai trò chấm (GVHD, phản biện, hội đồng). Tiêu chí có trọng số, tổng bằng 100.
- Điểm tiêu chí trên thang 0–10, bước 0,25 (CHECK trong DB). Điểm phiếu là trung bình có trọng số.
- **Điểm hội đồng** là trung bình phiếu của các thành viên. Nếu chênh lệch lớn nhất giữa các phiếu vượt `max_score_deviation` (mặc định 2,0), đồ án bị gắn cờ: **chủ tịch phải ghi biên bản giải trình** trước khi chốt.
- **Điểm tổng kết** = `w_gvhd·Đ_gvhd + w_pb·Đ_pb + w_hđ·Đ_hđ`, làm tròn 0,1. Quy đổi sang điểm chữ A/B+/B/C+/C/D+/D/F.
- **Khóa điểm:** sau khi chốt, trigger chặn mọi thay đổi phiếu và điểm thành phần.
- **Sổ cái điểm chống sửa (tamper-evident ledger):** mỗi lần chốt hoặc phúc khảo thêm một bản ghi gồm `hash = SHA-256(prev_hash ‖ payload)`. API kiểm chứng tính lại toàn chuỗi và phát hiện mọi chỉnh sửa trực tiếp trong DB.

## 10. Phúc khảo

- SV nộp đơn trong `appeal_window_days` kể từ ngày công bố. Mỗi đồ án có một đơn.
- Trưởng khoa quyết định. Nếu điều chỉnh điểm, hệ thống ghi bản ghi mới vào sổ cái và **không sửa phiếu gốc**.

## 11. Thành phần tự xây (giảm phụ thuộc bên thứ ba)

| Thay thế | Tự xây | Trạng thái |
|---|---|---|
| — | Phát hiện trùng lặp đề tài: chuẩn hóa tiếng Việt, shingling + MinHash/Jaccard (`similarity.ts`) | Đã làm |
| — | Bộ xếp lịch bảo vệ có ràng buộc (`scheduler.ts`) | Đã làm |
| — | Sổ cái điểm hash-chain (`grading.ts`, `thesis_grade_ledger`) | Đã làm |
| — | Máy trạng thái, khóa điểm, chống sửa lịch sử bằng trigger PostgreSQL | Đã làm |
| `@socket.io/postgres-adapter` | Bộ đồng bộ đa node dùng `LISTEN/NOTIFY` của PostgreSQL | Kế hoạch |
| AWS S3 SDK | Kho tệp đánh địa chỉ theo nội dung (SHA-256), khử trùng lặp, đếm tham chiếu, hạn mức | Kế hoạch |
| Tìm kiếm `ILIKE` | Chỉ mục ngược tiếng Việt: chuẩn hóa dấu, tách từ, xếp hạng BM25 | Kế hoạch |

## 12. Báo cáo và giám sát

- **Dashboard đợt:** số đồ án theo trạng thái, tải hướng dẫn từng GV so với định mức, bản nộp trễ, phân phối điểm.
- **Cảnh báo đồ án có nguy cơ:**
  - quá 14 ngày không có nhật ký được xác nhận;
  - quá hạn mốc mà chưa nộp.
- **Xuất CSV:** danh sách phân công, lịch bảo vệ, bảng điểm.

## 13. Lộ trình thực hiện

| Giai đoạn | Nội dung | Migration | Trạng thái |
|---|---|---|---|
| 1 | Tổ chức, đợt, SV, đề tài, nhóm, nguyện vọng, đồ án, máy trạng thái, audit | 022 | Xong |
| 2 | Mốc, bản nộp, nhật ký hướng dẫn | 023 | Xong |
| 3 | Phản biện, hội đồng, lịch bảo vệ, chấm điểm, sổ cái, phúc khảo | 024 | Xong |
| 4 | Dashboard, cảnh báo, xuất CSV, thông báo; giao diện web `/app/thesis` | — | Xong |
| 5 | Các thành phần hạ tầng tự xây còn lại ở mục 11 | 025+ | Kế hoạch |

## 14. Kiểm chứng

| Lệnh | Nội dung |
|---|---|
| `npm test` | 7 test quy tắc thuần: rubric, độ lệch, quy đổi điểm chữ, hash-chain, xếp lịch, trùng lặp tiếng Việt, CSV injection |
| `npm run test:integration` | `academic.test.js` chạy trọn vòng đời trên PostgreSQL thật (chi tiết bên dưới) |
| `npm run seed:academic` | Tạo khoa CNTT demo: 39 tài khoản, đợt HK1 đang thực hiện, đợt HK2 đang đăng ký. `-- --reset` để tạo lại |

`academic.test.js` kiểm chứng các điểm sau:

- **Tranh chấp đồng thời:** hai GV cùng nhận một nhóm thì chỉ một người thành công.
- **Giới hạn:** sức chứa đề tài và định mức hướng dẫn.
- **Phân tách trách nhiệm:** không tự duyệt đề tài; GVHD không chọn phản biện cho đồ án mình hướng dẫn; người đã chấm không xử lý phúc khảo.
- **Ràng buộc ở tầng DB:**
  - máy trạng thái của đợt và của đồ án;
  - bảng lịch sử chỉ được ghi thêm;
  - bản nộp bất biến;
  - nhật ký hướng dẫn bị khóa sau khi xác nhận;
  - phiếu điểm bị khóa;
  - chủ tịch hội đồng phải là TS;
  - EXCLUDE chống trùng lịch hội đồng và trùng lịch giảng viên.
- **Phát hiện chỉnh sửa trái phép:** sửa điểm trực tiếp trong DB (vượt qua trigger) bị sổ cái phát hiện.
