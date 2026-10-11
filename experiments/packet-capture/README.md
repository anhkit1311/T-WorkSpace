# Bắt và phân tích gói tin WebRTC

Mục tiêu: có bằng chứng ở mức gói tin cho Chương 5. Cần thấy được ICE/STUN, bắt tay DTLS, luồng SRTP (header RTP rõ), RTCP (SR/RR, NACK, PLI, REMB/TWCC), và đối chiếu bitrate, mất gói, jitter với số liệu `getStats()`.

## 1. Chuẩn bị

1. Cài **Wireshark** (kèm **Npcap**) từ wireshark.org. Khi cài Npcap, tick *Support loopback traffic capture*. Cần quyền quản trị.
2. Kiểm tra: `tshark --version`.
3. Chọn kịch bản:
   - **Hai máy trong LAN** (khuyến nghị, giống thực tế): máy A chạy API/SFU, máy B mở trình duyệt; bắt trên card Wi-Fi/Ethernet của máy A.
   - **Một máy**: dùng phòng thí nghiệm media (`npm run lab`). Lưu lượng tới IP LAN của chính máy được Windows định tuyến nội bộ, nên phải bắt trên adapter *Npcap Loopback Adapter* (hoặc `\Device\NPF_Loopback`).

SFU phải announce IP LAN (không phải `127.0.0.1`), nếu không media sẽ đi qua ICE-TCP (xem Chương 5). Ví dụ trong `.env`: `MEDIASOUP_ANNOUNCED_IP=192.168.1.60`.

## 2. Bắt gói

Xem danh sách interface:

```bash
tshark -D
```

Bắt 60 giây, chỉ lấy dải cổng media của mediasoup (thay `<IF>` bằng số/tên interface):

```bash
tshark -i <IF> -a duration:60 -f "udp portrange 40000-49999 or tcp portrange 40000-49999" -w experiments/packet-capture/sfu-4clients.pcapng
```

Trong khi bắt, chạy một ca thực nghiệm, ví dụ:

```bash
npm run lab -- --mode=sfu --clients=4 --seconds=40 --warmup=10 --render=0
```

## 3. Xuất trường và phân tích

Wireshark không tự nhận RTP khi RTP/RTCP/STUN/DTLS ghép chung một cổng (rtcp-mux, BUNDLE), nên phải bật heuristic:

```bash
tshark -r experiments/packet-capture/sfu-4clients.pcapng -o rtp.heuristic_rtp:TRUE -o rtcp.heuristic_rtcp:TRUE -Y "stun || dtls || rtp || rtcp" -T fields -E header=y -E separator=, -E occurrence=a -E aggregator=; -e frame.time_epoch -e frame.len -e ip.src -e udp.srcport -e ip.dst -e udp.dstport -e stun.type -e dtls.record.content_type -e rtp.ssrc -e rtp.seq -e rtp.timestamp -e rtp.p_type -e rtcp.pt -e rtcp.rc > experiments/packet-capture/sfu-4clients.csv
```

```bash
node experiments/packet-capture/analyze.mjs experiments/packet-capture/sfu-4clients.csv --out=docs/evidence/packet-capture-sfu-4clients.json
```

Kết quả gồm: thời lượng, số gói STUN, số bản ghi DTLS, số gói theo từng loại RTCP, và bảng theo SSRC (hướng, payload type, số gói, kbps, % mất theo khoảng hổng sequence, jitter RFC 3550 tính từ thời điểm bắt).

## 4. Đọc kết quả

| Quan sát | Ý nghĩa | Bộ lọc Wireshark |
| --- | --- | --- |
| STUN Binding Request/Success đầu phiên, sau đó lặp ~mỗi 2,5 s | Kiểm tra kết nối ICE và consent freshness (RFC 7675) | `stun` |
| DTLS ClientHello → ServerHello → Certificate → Finished | Bắt tay DTLS-SRTP; sau đó không còn gói DTLS ứng dụng | `dtls.handshake` |
| Mỗi client gửi 3 SSRC video (q/h/f) + 1 audio tới SFU | Simulcast 3 lớp | `rtp && ip.dst == <SFU>` |
| Mỗi client nhận N−1 SSRC video (lớp do SFU chọn) | SFU chuyển tiếp chọn lọc | `rtp && ip.src == <SFU>` |
| SSRC 1234 từ SFU, gói padding | Probation thăm dò băng thông của mediasoup | `rtp.ssrc == 0x4d2` |
| RTCP 205 FMT 15 dày đặc | transport-cc phục vụ GCC | `rtcp.pt == 205` |
| RTCP 206 FMT 1 khi vào phòng/đổi lớp | PLI xin keyframe | `rtcp.pt == 206` |

So sánh với Mesh: `npm run lab -- --mode=mesh --clients=4 ...` khi đang bắt. Lúc này mỗi client gửi **N−1 luồng video độc lập** (mỗi luồng một SSRC, tới N−1 địa chỉ đích khác nhau), khác với SFU chỉ có một đích.

Đưa vào báo cáo: một ảnh chụp Wireshark *Statistics → Conversations (UDP)* và *Telephony → RTP → RTP Streams* cho mỗi chế độ, kèm bảng JSON từ `analyze.mjs`. Các file `.pcapng` lớn và có thể chứa IP nội bộ, nên không commit vào git.
