# BÁO CÁO ĐO KIỂM THỰC NGHIỆM HỆ THỐNG CỘNG TÁC THỜI GIAN THỰC & SFU WEBRTC

> **Đề tài luận văn**: _Phát triển nền tảng không gian làm việc cộng tác thời gian thực tích hợp hội nghị truyền hình đa điểm_  
> **Thời điểm đo kiểm**: `2026-09-18T14:36:00.036Z`  
> **Phạm vi đo đã xác minh từ script**: Socket.IO trên loopback, ghi tin vào PostgreSQL, join signaling và cấp phát transport mediasoup. Script không thiết lập ICE/DTLS, không truyền RTP và không đo chất lượng audio/video. JSON/CSV chỉ lưu số tổng hợp theo mức tải, chưa có từng mẫu đo.

---

## 1. Môi trường và điều kiện thực nghiệm

| Thông số phần cứng / phần mềm | Giá trị thực tế ghi nhận                                                                                                                                                              |
| :---------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **CPU**                       | AMD Ryzen 7 6800HS with Radeon Graphics (16 logical cores)                                                                                                                            |
| **Dung lượng RAM**            | 23.26 GB                                                                                                                                                                              |
| **Hệ điều hành**              | Windows_NT 10.0.26200 (win32 x64)                                                                                                                                                     |
| **Môi trường thực thi**       | Node.js v22.19.0, V8 Engine, C++ mediasoup worker 3.26.0                                                                                                                              |
| **Cơ sở dữ liệu**             | PostgreSQL 16 trong Docker container (`infra-postgres-1`)                                                                                                                             |
| **Điều kiện truyền dẫn**      | Môi trường Loopback `127.0.0.1` IPC / WebSocket. Kiểm thử độ trễ nội tại của server processing, DB commit, JSON serialization, Socket.IO multiplexing và mediasoup router allocation. |

---

## 2. Bảng tổng hợp kết quả đo kiểm hiệu năng theo số lượng Client

| Số Client (N) | Kết nối Socket | Chat Avg RTT | Chat p95 RTT | Chat Thông lượng (msg/s) | SFU Join Latency | SFU Transport Alloc | CPU Sử dụng | Bộ nhớ RSS |
| :-----------: | :------------: | :----------: | :----------: | :----------------------: | :--------------: | :-----------------: | :---------: | :--------: |
|     **1**     |    21.36 ms    |   7.31 ms    |   10.22 ms   |          135.3           |     57.82 ms     |       5.43 ms       |   25.27%    |  80.04 MB  |
|     **3**     |    56.51 ms    |   7.64 ms    |   14.36 ms   |          130.4           |     4.37 ms      |       2.09 ms       |   34.45%    |  80.8 MB   |
|     **5**     |    18.03 ms    |   7.91 ms    |   14.71 ms   |          125.7           |     2.12 ms      |       1.57 ms       |   22.79%    |  87.07 MB  |
|     **8**     |    24.42 ms    |   8.16 ms    |   13.88 ms   |          122.2           |     1.96 ms      |       1.64 ms       |   71.04%    |  92.5 MB   |

---

## 3. Phân tích kết quả thực nghiệm khoa học

1. **Chat**: “Chat RTT” trong bảng là thời gian từ lúc gửi đến client chậm nhất nhận broadcast trên loopback. Có 15 tin nhắn tuần tự mỗi mức tải; p95 có độ phân giải thấp và không đại diện mạng thực.
2. **SFU signaling**: Join và cấp phát 2 transport mỗi client thành công. Chưa kiểm chứng ICE/DTLS, publish/consume RTP, jitter, packet loss hoặc bitrate.
3. **Tài nguyên**: CPU và RSS trong JSON đo tiến trình Node.js chạy benchmark cùng API. Số này không bao gồm worker mediasoup riêng và PostgreSQL. CPU 8 client ghi 71.04%, vì vậy nhận định cũ “<20%” là sai.
4. **Dữ liệu gốc**: JSON/CSV hiện lưu số tổng hợp theo mức tải, chưa có từng mẫu chat hay số đo trình duyệt. Cần chạy ca đo có log từng mẫu và WebRTC getStats trước khi đưa ra kết quả QoS luận văn.

---

_Tệp dữ liệu gốc được lưu trữ tại:_

- JSON thô: `docs/benchmarks/benchmark-results.json`
- Bảng tính CSV: `docs/benchmarks/benchmark-results.csv`
