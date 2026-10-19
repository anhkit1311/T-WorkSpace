# BÁO CÁO ĐO KIỂM THỰC NGHIỆM HỆ THỐNG CỘNG TÁC THỜI GIAN THỰC & SFU WEBRTC

> **Đề tài luận văn**: *Phát triển nền tảng không gian làm việc cộng tác thời gian thực tích hợp hội nghị truyền hình đa điểm*  
> **Thời điểm đo kiểm**: `2026-10-19T16:12:07.443Z`  
> **Phạm vi đo**: Socket.IO trên loopback, ghi tin vào PostgreSQL, join signaling và cấp phát transport mediasoup. Không thiết lập ICE/DTLS, không truyền RTP và không đo chất lượng audio/video.

---

## 1. Môi trường và điều kiện thực nghiệm

| Thông số phần cứng / phần mềm | Giá trị thực tế ghi nhận |
| :--- | :--- |
| **CPU** | AMD Ryzen 7 6800HS with Radeon Graphics          (16 logical cores) |
| **Dung lượng RAM** | 23.26 GB |
| **Hệ điều hành** | Windows_NT 10.0.26300 (win32 x64) |
| **Môi trường thực thi** | Node.js v22.19.0, V8 Engine, C++ mediasoup worker 3.26.0 |
| **Cơ sở dữ liệu** | PostgreSQL 16 trong Docker container (`infra-postgres-1`) |
| **Điều kiện truyền dẫn** | Loopback `127.0.0.1` / WebSocket; 15 tin nhắn tuần tự mỗi mức tải. |

---

## 2. Bảng tổng hợp kết quả đo kiểm hiệu năng theo số lượng Client

| Số Client (N) | Kết nối Socket | Chat Avg RTT | Chat p95 RTT | Chat Thông lượng (msg/s) | SFU Join Latency | SFU Transport Alloc | CPU Sử dụng | Bộ nhớ RSS |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **1** | 27.25 ms | 24.05 ms | 33.33 ms | 38 | 164.33 ms | 9.4 ms | 15.18% | 101.67 MB |
| **3** | 25.44 ms | 25.11 ms | 35.61 ms | 36.5 | 23.8 ms | 4.34 ms | 30.61% | 107.25 MB |
| **5** | 38.52 ms | 24.67 ms | 34.93 ms | 36.9 | 19.77 ms | 3.17 ms | 30.9% | 112.41 MB |
| **8** | 43.81 ms | 24.85 ms | 33.12 ms | 36.5 | 14.53 ms | 2.4 ms | 74.18% | 88.46 MB |

---

## 3. Phân tích kết quả thực nghiệm khoa học

1. **Chat**: Cột Chat RTT là thời gian từ phát lệnh gửi đến client chậm nhất nhận broadcast trên loopback. Mỗi mức tải chỉ có 15 mẫu; p95 có độ phân giải thấp và không đại diện mạng thực.
2. **SFU signaling**: Join và cấp phát 2 transport mỗi client thành công. Chưa kiểm chứng ICE/DTLS, publish/consume RTP, jitter, packet loss hay bitrate.
3. **Tài nguyên**: CPU và RSS đo tiến trình Node.js chạy benchmark cùng API. Không bao gồm CPU/RAM mediasoup worker và PostgreSQL; không suy diễn tổng tài nguyên server.
4. **Dữ liệu gốc**: JSON/CSV hiện lưu số tổng hợp theo mức tải, chưa lưu từng mẫu chat hoặc số đo trình duyệt. Cần chạy ca đo có log per-sample và WebRTC getStats trước khi dùng làm kết quả QoS luận văn.

---
*Tệp dữ liệu gốc được lưu trữ tại:*
- JSON thô: `docs/benchmarks/benchmark-results.json`
- Bảng tính CSV: `docs/benchmarks/benchmark-results.csv`
