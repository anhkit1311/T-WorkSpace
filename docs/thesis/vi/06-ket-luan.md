# Kết luận và hướng phát triển

## Kết quả đạt được so với mục tiêu

Chương 1 đặt ra bốn mục tiêu. Bảng 6.1 nhắc lại từng mục tiêu, tóm tắt kết quả đạt được, cách kiểm chứng và mức độ hoàn thành.

TABLE: Bảng 6.1. Mục tiêu ở Chương 1 và mức độ đạt được
| Mục tiêu | Kết quả | Minh chứng | Mức độ |
| --- | --- | --- | --- |
| O1 – Không gian làm việc tích hợp | Ứng dụng web tổ chức theo Workspace → Channel với kênh văn bản, thoại và video, kênh riêng tư, lời mời, phân quyền, quản trị và nhật ký, kèm bảng công việc, thông báo, tìm kiếm và hồ sơ cá nhân | Chương 3–4; kiểm thử nghiệm thu trên trình duyệt; Hình 4.6–4.10 | Đạt |
| O2 – Nhắn tin và trạng thái hiện diện thời gian thực | Gửi tin lũy đẳng (mã do client sinh, outbox IndexedDB, advisory lock và ràng buộc duy nhất), lấy bù tin sau khi kết nối lại, presence có TTL giữa các tiến trình, trạng thái đang gõ | Mục 5.2; mục 5.3: 0 tin mất, 0 tin trùng, p95 nhận tin ≤ 46 ms với 200 socket | Đạt trên một máy; chưa đo trên mạng diện rộng |
| O3 – Hội nghị truyền hình đa điểm | SFU mediasoup với nhóm worker, simulcast ba lớp, chọn lớp và tạm dừng theo nhu cầu, phục hồi ICE, thông tin xác thực TURN có thời hạn, phòng chờ và điều hành | Mục 5.4: @O3_EVIDENCE@ | Đạt trong phòng thí nghiệm; còn thiếu thử nghiệm nhiều mạng và TURN |
| O4 – Đánh giá định lượng | Phòng thí nghiệm media với trình duyệt thật, lặp nhiều lượt và lưu dữ liệu gốc; kiểm tra tải lõi nhắn tin; so sánh với hệ thống chuẩn Mesh | Chương 5, dữ liệu gốc trong `docs/evidence/` | Đạt trên một máy; còn thiếu bắt gói tin và thử nghiệm nhiều máy |

Luận điểm kỹ thuật trung tâm của đồ án, rằng SFU giữ chi phí của mỗi người tham gia không phụ thuộc vào quy mô phòng trong khi Mesh thì không, đã được kiểm chứng bằng thực nghiệm trên cùng phần cứng. @O3_SUMMARY@

## Đóng góp của đồ án

Các đóng góp chính của đồ án gồm:

1. Một nền tảng cộng tác hoạt động được, có thể tự triển khai, tích hợp nhắn tin theo kênh lâu dài và hội nghị đa điểm trong cùng một ứng dụng trình duyệt, với một mô hình phân quyền thống nhất được áp dụng cho mọi yêu cầu REST và mọi sự kiện socket.
2. Một giao thức gửi tin kết hợp mã định danh do client sinh, outbox bền vững, advisory lock trong phạm vi giao dịch và ràng buộc duy nhất, để có ngữ nghĩa lưu đúng một lần trên nền truyền ít nhất một lần, đã được kiểm chứng với các trường hợp mất acknowledgement, gửi lại đồng thời và kết nối lại.
3. Một lưới video theo nhu cầu, suy ra lớp simulcast của từng consumer từ kích thước ô hiển thị và tạm dừng các consumer không hiển thị, để downlink đi theo những gì người dùng nhìn thấy thay vì theo quy mô phòng.
4. Một phòng thí nghiệm media có thể chạy lại, trong đó mỗi người tham gia là một trình duyệt thật, so sánh SFU với hệ thống chuẩn Mesh trong cùng điều kiện, lặp lại từng mức và lưu toàn bộ mẫu gốc, kèm ghi chép các sai lệch đo lường (công bố địa chỉ loopback và gói thăm dò băng thông) mà nếu bỏ qua sẽ làm sai kết quả.

## Hạn chế

- Mọi phép đo media và nhắn tin đều thực hiện trên một máy, qua đường nội bộ tới địa chỉ LAN của chính máy đó. Kết quả phản ánh tin cậy xu hướng và chi phí tương đối, nhưng chưa đo hành vi khi có độ trễ, mất gói hay giới hạn băng thông thật.
- Chưa bắt gói tin, nên hoạt động của DTLS-SRTP và RTCP mới được chứng minh qua đặc tả và qua `getStats()`, chưa có bằng chứng ở mức gói tin.
- Camera giả tạo nội dung đơn giản; camera thật sẽ cho bitrate cao hơn, và chi phí vẽ video đã bị loại khỏi số đo CPU.
- Mô hình SFU nhiều node, TURN trên máy chủ công khai, gửi e-mail thật, lưu trữ đám mây, CI từ xa và sao lưu trên môi trường thật đã được hiện thực hoặc cấu hình nhưng chưa được nghiệm thu trên hạ tầng thật. Vì vậy hệ thống chưa được khẳng định là sẵn sàng cho môi trường sản xuất.
- Chưa có ứng dụng di động gốc, chưa ghi hình cuộc họp và chưa có mã hóa đầu-cuối xuyên qua SFU.

## Hướng phát triển

1. **Đánh giá trên nhiều mạng.** Lặp lại thực nghiệm media với client trên nhiều máy và nhiều mạng, có một client buộc phải đi qua TURN, và với suy giảm mạng có kiểm soát (mất gói, độ trễ, giới hạn băng thông) tại bộ định tuyến; bắt gói tin bằng Wireshark để phân tích STUN, DTLS, RTP và RTCP (SR/RR, NACK, PLI) và đối chiếu với `getStats()`.
2. **Tự chọn cấu trúc kết nối cho phòng nhỏ.** Dùng một bản mã hóa hoặc truyền ngang hàng cho cuộc gọi hai người, nơi simulcast tốn uplink hơn lợi ích mang lại, và chuyển sang SFU khi người thứ ba tham gia.
3. **Chọn luồng theo người đang nói.** Kết hợp lưới video theo nhu cầu với việc chọn luồng chuyển tiếp dựa trên mức âm thanh (theo tinh thần của Last N [@lastn]) cho các phòng lớn.
4. **Mở rộng tầng media.** Nối router giữa các worker và các node (pipe) để một cuộc họp rất lớn có thể trải trên nhiều worker, và nghiệm thu mô hình nhiều node với cân bằng tải trên máy chủ thật.
5. **Tính năng sản phẩm.** Tin nhắn trực tiếp giữa hai người, ghi hình cuộc họp, mã hóa đầu-cuối bằng insertable streams, và ứng dụng di động gốc hoặc ứng dụng web tiến bộ.

Tóm lại, đồ án đã xây dựng được một không gian làm việc thời gian thực tích hợp hội nghị đa điểm ngay trên trình duyệt, và chứng minh bằng các phép đo có thể lặp lại rằng kiến trúc media dựa trên SFU của hệ thống mở rộng được ở những quy mô mà hệ thống chuẩn ngang hàng không đáp ứng nổi. Phần việc còn lại chủ yếu là mở rộng phạm vi đánh giá từ một máy sang mạng thật và hạ tầng thật.
