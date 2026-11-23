# Dàn ý báo cáo đồ án (bản viết lại theo đề tài mới)

**Tên đề tài:** Xây dựng các dịch vụ call center, video conferencing, e-learning cho doanh nghiệp (áp dụng tại TDTU)

Giữ khung 7 chương của mẫu khoa ([Bao_Cao_Do_An_T-WorkSpace_Mau_Khoa.docx](Bao_Cao_Do_An_T-WorkSpace_Mau_Khoa.docx)).
Thay nội dung theo đặc tả 14/10. Ước lượng tổng: khoảng 90–110 trang nội dung, 80–100 hình và bảng.

Ký hiệu ở mỗi mục:

- **[Giữ]**: lấy lại từ bản 06-11, chỉ sửa câu chữ.
- **[Sửa]**: có sẵn nhưng phải viết lại theo đề tài mới.
- **[Mới]**: chưa có, phải viết mới.
- **[Bỏ]**: xóa khỏi báo cáo.

Nguồn số liệu và tài liệu ghi trong ngoặc vuông ở cuối dòng.

---

## Phần đầu

- Bìa, lời cảm ơn, lời cam đoan, tóm tắt (VN + EN) **[Sửa]**. Tóm tắt phải nêu cả 3 dịch vụ và 3 kết quả đo chính: chịu được 200 cuộc gọi đồng thời, MOS 4,39 trên LAN, service level 88,5% ở ca thường.
- Mục lục, danh mục hình, bảng, chữ viết tắt **[Sửa]**. Thêm các từ viết tắt: PBX, SIP, RTP, ARI, ACD, IVR, CDR, ASA, AHT, MOS, HLS.

## Chương 1. Mở đầu và tổng quan đề tài (~8 trang)

1.1 Lý do chọn đề tài **[Sửa]**: bài toán của TDTU.
- Tổng đài PSTN tốn phí thuê đường dây và cước giữa các cơ sở.
- Không có ghi âm, thống kê và phân luồng cuộc gọi.
- Họp và dạy học dùng công cụ bên ngoài, tách rời dữ liệu của trường.

1.2 Mục tiêu **[Sửa]**: chép đúng các mục tiêu trong đặc tả.
- Gọi nội bộ, gọi vào và gọi ra qua đầu số.
- IVR, voicemail, ghi âm, giám sát.
- Họp và e-learning chạy đủ nghiệp vụ chính.
- 2 luồng liên thông.
- Đánh giá chất lượng thoại bằng bắt gói (Wireshark) và độ chịu tải bằng SIPp.

1.3 Đối tượng và phạm vi **[Sửa]**: 6 vai trò cộng thêm người gọi bên ngoài, cây đơn vị khoa/phòng ban.
- 1.3.3 Giới hạn: ghi rõ những gì đã cắt khỏi đặc tả.
  - Họp hội đồng chấm điểm (NV-MT3, BR-12) đã bỏ, kèm lý do.
  - Trunk thật mới thông chiều gọi ra.

1.4 Phương pháp thực hiện **[Giữ/Sửa]**.

1.5 Khảo sát giải pháp hiện có **[Sửa]**.
- Bảng so sánh mới gồm FreePBX/Issabel, 3CX, Genesys/Zoom Contact Center (nhóm call center); Zoom/Teams/Jitsi/BigBlueButton (nhóm họp); Moodle/Canvas (nhóm e-learning).
- Thông điệp cần nêu: chưa có giải pháp nào gộp cả ba dịch vụ trên dữ liệu chung của trường.
- Bỏ các cột so sánh với Slack.

1.6 Đóng góp của đề tài **[Mới]**.
- ACD tự viết điều khiển Asterisk qua ARI.
- Softphone chạy trên web.
- 3 luồng liên thông.
- Gọi điện thoại vào phòng họp (dial-in).
- Chép lời ghi âm để giám sát đọc và tìm kiếm.

1.7 Bố cục báo cáo **[Sửa]**.

## Chương 2. Cơ sở lý thuyết (~18 trang)

Phần thiếu nặng nhất. Đặt VoIP lên đầu vì call center là phần lõi.

2.1 Điện thoại IP (VoIP) **[Mới]**
- 2.1.1 Từ PSTN đến VoIP, khái niệm PBX/IP-PBX.
- 2.1.2 SIP: các thông điệp, luồng INVITE/200/ACK/BYE, đăng ký máy lẻ, SDP. Có hình sequence.
- 2.1.3 RTP/RTCP, codec thoại G.711, Opus, jitter buffer.
- 2.1.4 SIP trunk và đầu số. NAT với SIP: rport, ICE, chế độ media qua máy chủ.
- 2.1.5 SIP trên WebSocket (RFC 7118) và JsSIP: softphone trong trình duyệt.

2.2 Asterisk **[Mới]**
- Kiến trúc kênh, dialplan, PJSIP.
- Các ứng dụng: Queue, VoiceMail, MixMonitor, ChanSpy.
- ARI và mô hình Stasis: ứng dụng ngoài điều khiển cuộc gọi.
- Lý do tự viết ACD thay vì dùng app_queue.

2.3 Lý thuyết call center **[Mới]**
- ACD và các chiến lược phân phối (rảnh lâu nhất, xoay vòng).
- IVR, wrap-up, mã kết quả, CDR.
- Công thức các KPI ASA, AHT, tỉ lệ bỏ máy, service level (bảng KPI trong đặc tả).
- Mô hình Erlang C (nhắc ngắn) để giải thích kết quả ca cao điểm ở Chương 6.

2.4 Đánh giá chất lượng thoại **[Mới]**
- Các chỉ số mất gói, jitter, độ trễ.
- E-model (ITU-T G.107), cách quy đổi R-factor sang MOS.
- Công cụ: Wireshark (phân tích luồng RTP), SIPp.

2.5 WebRTC **[Giữ, rút gọn]**: tín hiệu, ICE/STUN/TURN, DTLS-SRTP.

2.6 Kiến trúc hội nghị đa điểm: Mesh/MCU/SFU, simulcast, mediasoup **[Giữ, gộp 2.3–2.5 cũ]**. [hinh-2-1, hinh-2-2]

2.7 Video theo yêu cầu: HLS, chuyển mã bằng FFmpeg **[Sửa từ 2.8 cũ]**.

2.8 Nền tảng ứng dụng **[Sửa, rút gọn]**.
- React, Fastify/Node, Socket.IO (gộp 2.1 cũ vào đây).
- PostgreSQL, Redis, MinIO.
- RBAC kết hợp phạm vi dữ liệu.

## Chương 3. Phân tích và thiết kế hệ thống (~25 trang)

3.1 Phân tích yêu cầu **[Sửa]**
- 3.1.1 Tác nhân: 6 vai trò cộng người gọi bên ngoài, vai trò cộng dồn và vai trò theo ngữ cảnh.
- 3.1.2 Use case tổng quát và use case cho từng dịch vụ **[Mới]**: vẽ lại hinh-3-2, tách thành 3 hình.
- 3.1.3 Đặc tả nghiệp vụ, mỗi nghiệp vụ một bảng (tác nhân, kích hoạt, luồng chính, luồng rẽ):
  - Call center: NV-CC1 đến NV-CC5.
  - Họp: NV-MT1, NV-MT2, NV-MT4.
  - E-learning: NV-EL1 đến NV-EL4.
  - Liên thông: LT1, LT2, LT3.
- 3.1.4 Bảng 22 quy tắc nghiệp vụ, thêm cột "Cài ở đâu" (module/hàm). BR-12 ghi là đã bỏ.
- 3.1.5 Yêu cầu phi chức năng. Có số cụ thể: tối thiểu 50 cuộc gọi đồng thời, MOS ≥ 4,0, ASA ≤ 20 s.

3.2 Kiến trúc tổng thể **[Sửa]**
- Sơ đồ khối mới có thêm khối Asterisk, SIP trunk Pitel, speech service.
- Ranh giới trách nhiệm: Asterisk lo SIP và media, web app lo ACD, ticket và báo cáo.
- 3.2.x Khối tổng đài **[Mới]**:
  - Các context của dialplan: from-web, from-trunk, from-internal-out, denied, blocked.
  - Đánh số máy lẻ theo đơn vị (BR-22).
  - Chặn đầu số quốc tế, giới hạn kênh trunk (OUTBOUND_MAX).

3.3 Thiết kế máy trạng thái **[Mới]**, phần đáng giá nhất của chương.
- Trạng thái tổng đài viên: 7 trạng thái theo bảng NV-CC2, kèm các mốc 20 s / 60 s / 30 s.
- Trạng thái cuộc gọi: Chờ, Đổ chuông, Đang nói, Hoàn tất, Xong / Bỏ máy / Nhỡ.
- Trạng thái ticket: Mới, Đang xử lý, Chờ phản hồi, Đã giải quyết, Đóng.
- Trạng thái khóa học: Nháp, Xuất bản, Lưu trữ.

3.4 Thiết kế cơ sở dữ liệu **[Sửa]**
- Vẽ lại ERD theo 4 nhóm: tài khoản/đơn vị, tổng đài, họp, e-learning.
- Bỏ ERD nhóm chat (hinh-3-3a).
- Mô tả các bảng chính và ràng buộc toàn vẹn.

3.5 Thiết kế giao tiếp **[Sửa]**: các nhóm REST API, sự kiện Socket.IO, sự kiện ARI.

3.6 Các luồng xử lý chính (sequence) **[Mới, trừ 3.6.4]**
- 3.6.1 Cuộc gọi hotline từ đầu đến cuối: IVR, xếp hàng, ACD chọn người, đổ chuông, nhận máy, ghi âm, wrap-up.
- 3.6.2 Đổ chuông quá 20 s và quay lại hàng đợi (BR-04). Chờ quá 5 phút thì vào voicemail và tạo ticket (BR-05).
- 3.6.3 Giám sát nghe xen / nhắc nhỏ / tham gia qua ChanSpy.
- 3.6.4 Vào phòng họp trên SFU **[Giữ hinh-3-4]**.
- 3.6.5 LT1: nút "Cần hỗ trợ", gọi hotline kèm ngữ cảnh, tạo ticket, đặt lịch họp.
- 3.6.6 LT2: buổi live kết thúc, chốt điểm danh, chuyển bản ghi sang HLS, đăng thành bài học.
- Bỏ hinh-3-5 (sequence của chat).

3.7 Thiết kế phân quyền **[Sửa]**: 3 lớp (RBAC, phạm vi dữ liệu, vai trò theo ngữ cảnh), ma trận quyền, các quy tắc bảo vệ dữ liệu.

3.8 Thiết kế triển khai **[Sửa hinh-3-6]**: Docker Compose, nginx, coturn, Asterisk, Prometheus/Grafana.

## Chương 4. Triển khai hệ thống (~22 trang)

4.1 Môi trường, công nghệ, cấu trúc monorepo (apps/web, services/api, packages/shared) **[Sửa]**.

4.2 Xác thực, tài khoản, cây đơn vị, phân quyền **[Sửa]**.

4.3 Tổng đài **[Mới]**, phần dài nhất của chương.
- 4.3.1 Cấu hình Asterisk: PJSIP, máy lẻ WebRTC, trunk Pitel, fail2ban.
- 4.3.2 ACD qua ARI. Cách bảo đảm từng quy tắc: BR-02/03 (mỗi người một cuộc, chỉ giao cho người Sẵn sàng), BR-04 (đổ chuông 20 s), BR-09 (mất kết nối 30 s). [acd-service.ts, agent-service.ts]
- 4.3.3 Softphone web bằng JsSIP; chuyển máy thẳng và chuyển máy có hỏi ý. [DeskDialer, TransferPanel]
- 4.3.4 IVR, giờ làm việc (BR-01), voicemail kèm email. [voicemail-service.ts]
- 4.3.5 Ghi âm (BR-06), chép lời, QA chấm chất lượng. [call-transcript-service.ts, qa-service.ts]
- 4.3.6 Ticket và tác vụ định kỳ: tự đóng (BR-08), xóa sau 90 ngày (BR-17). [ticket-service.ts]
- 4.3.7 Gọi ra: quyền gọi, chặn số quốc tế, giới hạn 30 phút và số kênh (BR-20, BR-21).
- 4.3.8 Wallboard, KPI, báo cáo, xuất CSV và Excel (.xlsx), link ghi âm có chữ ký 60 s kèm nhật ký nghe. [report-service.ts, KpiPanel]

4.4 Họp trực tuyến **[Giữ 4.4 cũ, rút gọn]**
- Simulcast, thích ứng theo mạng, chịu lỗi mạng.
- Thêm: phòng chờ (BR-10), co-host, ghi hình (BR-11), gọi điện thoại vào phòng họp. [phone-bridge.ts, dial-in.ts]

4.5 Sau cuộc họp **[Giữ 4.5 cũ]**: điểm danh, xuất danh sách, biên bản, bản ghi HLS.

4.6 E-learning **[Sửa 4.6 cũ]**
- Khóa, chương, bài: 4 loại bài.
- Ngân hàng câu hỏi, quiz (BR-15).
- Ghi danh theo 3 hình thức (BR-13).
- Tiến độ, hoàn thành (BR-16), chứng nhận.

4.7 Các luồng liên thông **[Mới]**: LT1, LT2, LT3 (BR-18), mỗi luồng gồm code chính và ảnh minh họa.

4.8 Vận hành **[Giữ]**: giám sát Prometheus/Grafana, backup và khôi phục dữ liệu, triển khai VPS.

4.9 Kiểm thử **[Sửa]**: unit test (64 web, 100 API), test tích hợp, e2e Playwright. Bảng test theo BR.

**[Bỏ]** 4.3 cũ (nhóm/kênh/chat/Kanban) và 4.7 cũ (cổng thông tin), chỉ để lại 1 đoạn ngắn trong 4.2 nếu cần.

## Chương 5. Giao diện hệ thống (~15 trang)

Chụp lại toàn bộ sau khi chốt giao diện Tailwind. Ảnh cũ ngày 25/10 không dùng được.

- 5.1 Bố cục chung, điều hướng theo vai trò.
- 5.2 Đăng nhập, hồ sơ.
- 5.3 Tổng đài **[Mới phần lớn]**:
  - Màn hình trực của tổng đài viên: trạng thái, khóa bắt buộc.
  - Cuộc gọi đến kèm hồ sơ người gọi.
  - Wrap-up và mã kết quả.
  - Ticket (danh sách và chi tiết).
  - Voicemail.
  - Wallboard và KPI của giám sát.
  - Nghe xen.
  - QA và ghi âm kèm chép lời.
  - Quản trị: máy lẻ, hotline, IVR, trunk.
  - Màn hình "Liên hệ phòng ban" phía sinh viên.
- 5.4 Họp: lịch, chuẩn bị vào phòng, phòng họp, phòng chờ, điều hành, ghi hình, điểm danh. Chụp lại ảnh 09-room, ảnh cũ có chữ "jitsi" ở góc.
- 5.5 E-learning: phía giảng viên (soạn khóa, ngân hàng câu hỏi, học viên) và phía sinh viên (học, quiz, chứng nhận).
- 5.6 Luồng liên thông nhìn từ giao diện (chuỗi ảnh LT1).
- 5.7 Quản trị hệ thống, nhật ký hoạt động, sức khỏe hệ thống.
- 5.8 Giao diện trên điện thoại.
- 5.9 Bảng tổng hợp màn hình × vai trò × nghiệp vụ.

**[Bỏ]** 5.4 cũ (nhắn tin, nhóm).

## Chương 6. Thực nghiệm và đánh giá (~15 trang)

Lấy [chuong-danh-gia.md](chuong-danh-gia.md) làm khung, dữ liệu trong `docs/benchmarks/raw/`.

- 6.1 Mục tiêu, tiêu chí, phương pháp.
- 6.2 Môi trường đo (cấu hình máy, phiên bản, netem).
- 6.3 Thực nghiệm 1: độ chịu tải tổng đài bằng SIPp, mức 10 → 200 cuộc.
  - Biểu đồ tỉ lệ thành công, độ trễ thiết lập cuộc gọi, CPU theo từng mức.
  - Điểm bão hòa ở tầng ARI/ACD. [raw/sipp/level-*]
- 6.4 Thực nghiệm 2: chất lượng thoại trên LAN, Wi-Fi, 4G, 4G yếu, quá tải.
  - Mất gói, jitter, MOS.
  - Ảnh chụp phân tích luồng RTP trong Wireshark. [raw/voice-quality]
- 6.5 Thực nghiệm 3: mô phỏng ca trực thường và ca cao điểm.
  - ASA, tỉ lệ bỏ máy, service level.
  - Giải thích ca cao điểm bằng Erlang C. [raw/callcenter-shift*]
- 6.6 Thực nghiệm 4: họp qua TURN/UDP và TURN/TCP, media lab 12 người. [evidence/media-lab]
- 6.7 Thực nghiệm 5: mesh và SFU **[Giữ 6.5 cũ, rút gọn]**.
- 6.8 Kiểm thử chức năng: bảng 22 quy tắc nghiệp vụ, cột kết quả lấy từ test hoặc kịch bản tay.
- 6.9 Đối chiếu với đặc tả: bảng ở mục 4 của chuong-danh-gia.md.
- 6.10 Hạn chế và các yếu tố làm giảm độ tin cậy: mục 6 của chuong-danh-gia.md (đo trên 1 máy, netem, chưa qua trunk thật).

**[Bỏ]** 6.3 cũ (k6 HTTP) và 6.4 cũ (độ trễ chat), hoặc chuyển xuống phụ lục.

## Chương 7. Kết luận và hướng phát triển (~4 trang)

- 7.1 Kết quả đạt được, đối chiếu từng mục tiêu ở 1.2.
- 7.2 Hạn chế:
  - Chiều gọi vào qua trunk chưa thông.
  - Chưa có VPS production.
  - Chưa có bài tự luận chấm tay, chưa có làm mờ/thay nền trong họp.
  - Đã bỏ họp hội đồng chấm điểm.
- 7.3 Hướng phát triển:
  - Mở rộng nhiều nút Asterisk.
  - Gọi lại tự động, chatbot hoặc voicebot trong IVR.
  - Phân tích cảm xúc trên bản chép lời.
  - Tích hợp LMS/SSO của trường.

## Tài liệu tham khảo và phụ lục

- Tài liệu tham khảo **[Sửa]**:
  - Thêm RFC 3261 (SIP), RFC 3550 (RTP), RFC 7118 (SIP over WebSocket), ITU-T G.711 / G.107, tài liệu Asterisk/ARI, SIPp, Erlang C.
  - Bỏ tài liệu Slack/Kanban.
- Phụ lục:
  - Trích dialplan.
  - Kịch bản SIPp.
  - Bảng API.
  - Hướng dẫn cài đặt ([trien-khai-vps.md](../deploy/trien-khai-vps.md)).
  - Kịch bản demo.

---

## Danh sách việc phải làm

| Việc | Ước lượng |
| --- | --- |
| Vẽ mới: sequence SIP, kiến trúc Asterisk/ARI, 4 máy trạng thái, 3 use case, ERD 4 nhóm, sơ đồ khối mới, 4 sequence luồng | ~14 hình |
| Chụp lại màn hình sau khi chốt giao diện, ưu tiên tổng đài | ~60 ảnh |
| Vẽ biểu đồ từ số liệu SIPp, MOS, KPI ca trực | ~6 biểu đồ |
| Viết mới Chương 2 (VoIP, Asterisk, call center, QoS thoại) | ~12 trang |
| Viết mới 3.3, 3.6, 4.3, 4.7 | ~25 trang |
| Chốt với giảng viên hướng dẫn: bỏ NV-MT3 | 1 buổi |
