# QoS và đo kiểm — cập nhật01/10/2026

Source hiện tại: apps/web/src/features/meetings/webrtc/qos.ts (QosCollector), mediasoup-service và MeetingContext.

- RTT: transport.selectedCandidatePairId → candidate-pair succeeded; lấy lớn nhất giữa transport, giây→ms. Không phải latency một chiều.
- Bitrate gửi/nhận: delta bytes của outbound/inbound RTP chia delta thời gian, kbps; tổng là hai hướng cộng lại. Không lấy tổng transport overhead làm RTP bitrate.
- Jitter: lớn nhất inbound RTP trong mẫu, giây→ms.
- Packet loss: deltaLost/(deltaReceived+deltaLost) trong cửa sổ thống kê; reset/giảm counter bỏ cửa sổ đó.
- Mẫu đầu, counter reset hoặc thiếu dữ liệu: null, hiển thị “—”; không suy ra loss/RTT bằng0.
- Lấy mẫu2,5s, giữ300 mẫu (~12,5 phút), xuất CSV/JSON. QoS chưa lưu DB; CPU/RAM đo riêng bằng operations metrics/Docker.

Unit test kiểm selected pair, counter interval, tách hướng và reset. Browser join mic/cam tắt có “—” vì chưa có RTP. Test signaling/worker failure không thay thế media thật.

[Báo cáo20](20-benchmark-va-nghiem-thu.md) có raw chat50/100/200, định nghĩa phân vị/tài nguyên và procedure RTP3/6/10, TURN/impairment. Chưa có raw RTP đa mạng; không giữ những số liệu mô phỏng trước đây như kết quả thực nghiệm.
