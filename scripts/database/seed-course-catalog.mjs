// Full-length catalogue courses: each has 3 chapters of reading lessons, a quiz per chapter and a final
// exam drawn at random from the whole question bank. Courses that already exist (by code) are left
// untouched, so re-running never wipes enrollments or progress.
// Usage: npm run seed:courses   (or: node scripts/database/seed-course-catalog.mjs after a build)

import "../../dist/api/config/env.js";
import { pool } from "../../dist/api/infrastructure/database/db.js";
import { ElearningRepository } from "../../dist/api/modules/elearning/repository/elearning-repository.js";
import { CourseService } from "../../dist/api/modules/elearning/service/course-service.js";

const F = "```";
const letters = "abcdefgh";
const options = (texts) => texts.map((text, index) => ({ id: letters[index], text }));
/** One correct option (index). */
const one = (prompt, texts, correct, explanation) => ({
  kind: "single",
  prompt,
  options: options(texts),
  answer: [letters[correct]],
  explanation,
  points: 1,
});
/** Several correct options (indexes). */
const many = (prompt, texts, correct, explanation) => ({
  kind: "multiple",
  prompt,
  options: options(texts),
  answer: correct.map((index) => letters[index]),
  explanation,
  points: 2,
});
const tf = (prompt, answer, explanation) => ({
  kind: "true_false",
  prompt,
  options: [],
  answer: [answer],
  explanation,
  points: 1,
});

const COURSES = [
  {
    code: "PY-101",
    title: "Lập trình Python cơ bản",
    description:
      "Dành cho người chưa từng lập trình. Sau khóa học bạn viết được chương trình Python có biến, điều kiện, vòng lặp, hàm và xử lý dữ liệu bằng list, dict; đọc ghi được tệp văn bản. Thời lượng khoảng 6 giờ tự học, gồm 6 bài đọc, 3 bài kiểm tra chương và 1 bài thi cuối khóa.",
    chapters: [
      {
        title: "Chương 1: Làm quen với Python",
        lessons: [
          [
            "Bài 1: Biến, kiểu dữ liệu và phép toán",
            `# Biến, kiểu dữ liệu và phép toán

## Mục tiêu
- Khai báo và đặt tên biến đúng quy ước.
- Phân biệt bốn kiểu cơ bản: **int**, **float**, **str**, **bool**.
- Dùng được phép toán số học và chuyển kiểu.

## Biến là gì?
Biến là một cái tên gắn với một giá trị trong bộ nhớ. Python không cần khai báo kiểu: kiểu được suy ra từ giá trị gán vào.

${F}python
ho_ten = "Nguyễn Văn An"   # str
tuoi = 20                  # int
diem_tb = 8.25             # float
da_dong_hoc_phi = True     # bool
${F}

Tên biến viết thường, nối bằng dấu gạch dưới (snake_case), không bắt đầu bằng chữ số và không trùng từ khóa như **if**, **for**, **class**.

## Phép toán số học
- **+ - * /**: cộng, trừ, nhân, chia (kết quả của / luôn là float).
- **//**: chia lấy phần nguyên, **%**: chia lấy dư, \`**\`: lũy thừa.

${F}python
print(7 / 2)    # 3.5
print(7 // 2)   # 3
print(7 % 2)    # 1
print(2 ** 10)  # 1024
${F}

## Chuyển kiểu
Hàm **input()** luôn trả về chuỗi, nên muốn tính toán phải chuyển kiểu:

${F}python
nam_sinh = int(input("Năm sinh: "))
print("Tuổi của bạn:", 2026 - nam_sinh)
${F}

> Ghi nhớ: cộng một chuỗi với một số sẽ báo lỗi TypeError. Hãy chuyển về cùng kiểu trước khi cộng.`,
          ],
          [
            "Bài 2: Chuỗi ký tự và nhập xuất",
            `# Chuỗi ký tự và nhập xuất

## Mục tiêu
- Cắt chuỗi, nối chuỗi và dùng các phương thức thông dụng.
- In kết quả gọn gàng bằng f-string.

## Chỉ số và cắt chuỗi
Ký tự đầu tiên có chỉ số 0. Chỉ số âm đếm từ cuối chuỗi.

${F}python
ma_sv = "52100123"
print(ma_sv[0])     # '5'
print(ma_sv[-3:])   # '123'
print(ma_sv[:3])    # '521' (khóa tuyển sinh)
print(len(ma_sv))   # 8
${F}

## Phương thức thường dùng
- **strip()**: bỏ khoảng trắng hai đầu, rất cần khi xử lý dữ liệu người dùng nhập.
- **lower()**, **upper()**, **title()**: đổi kiểu chữ.
- **split()** tách chuỗi thành danh sách, **join()** ghép danh sách thành chuỗi.
- **replace(cũ, mới)**: thay thế.

Chuỗi là **bất biến**: mọi phương thức đều trả về chuỗi mới, chuỗi gốc không đổi.

## f-string
Đặt chữ f trước dấu nháy và viết biểu thức trong ngoặc nhọn:

${F}python
ten, diem = "An", 8.256
print(f"Sinh viên {ten} đạt {diem:.1f} điểm")   # Sinh viên An đạt 8.3 điểm
${F}

Phần sau dấu hai chấm là định dạng: **.1f** là một chữ số thập phân, **>10** là căn phải trong 10 ký tự.`,
          ],
        ],
        quiz: [
          one(
            "Kết quả của biểu thức 7 // 2 trong Python là gì?",
            ["3.5", "3", "4", "1"],
            1,
            "// là phép chia lấy phần nguyên nên 7 // 2 = 3.",
          ),
          tf(
            "Hàm input() trả về số nguyên nếu người dùng nhập toàn chữ số.",
            false,
            "input() luôn trả về chuỗi; muốn có số phải dùng int() hoặc float().",
          ),
          one(
            'Với s = "52100123", biểu thức s[-3:] cho kết quả nào?',
            ['"521"', '"123"', '"3"', '"0123"'],
            1,
            "Chỉ số âm đếm từ cuối; [-3:] lấy ba ký tự cuối cùng.",
          ),
        ],
      },
      {
        title: "Chương 2: Điều khiển luồng chương trình",
        lessons: [
          [
            "Bài 3: Câu lệnh điều kiện if / elif / else",
            `# Câu lệnh điều kiện

## Mục tiêu
- Viết được nhánh rẽ với **if**, **elif**, **else**.
- Kết hợp điều kiện bằng **and**, **or**, **not**.

## Cú pháp
Python dùng **thụt lề** (4 dấu cách) để xác định khối lệnh, không dùng ngoặc nhọn.

${F}python
diem = float(input("Điểm: "))
if diem >= 8.5:
    xep_loai = "Giỏi"
elif diem >= 7.0:
    xep_loai = "Khá"
elif diem >= 5.0:
    xep_loai = "Trung bình"
else:
    xep_loai = "Chưa đạt"
print(xep_loai)
${F}

Các nhánh được xét từ trên xuống và chỉ **một** nhánh đầu tiên đúng được chạy. Vì vậy phải viết điều kiện chặt nhất trước.

## Toán tử so sánh và logic
- So sánh: **==**, **!=**, **<**, **<=**, **>**, **>=**. Lưu ý **=** là gán, **==** mới là so sánh bằng.
- Logic: **and** (cả hai đúng), **or** (ít nhất một đúng), **not** (phủ định).

${F}python
if 0 <= diem <= 10 and diem == int(diem):
    print("Điểm nguyên hợp lệ")
${F}

## Giá trị được coi là sai
Số 0, chuỗi rỗng, danh sách rỗng và **None** đều được coi là False trong điều kiện. Nhờ vậy có thể viết gọn **if ten:** thay cho **if ten != "":**.`,
          ],
          [
            "Bài 4: Vòng lặp for và while",
            `# Vòng lặp for và while

## Mục tiêu
- Lặp qua dãy số và danh sách bằng **for**.
- Lặp theo điều kiện bằng **while**; dùng **break** và **continue**.

## for với range
**range(n)** sinh các số từ 0 đến n-1; **range(a, b, k)** đi từ a đến trước b với bước k.

${F}python
tong = 0
for i in range(1, 101):
    tong += i
print(tong)   # 5050
${F}

## for qua danh sách
${F}python
diem = [7.5, 9.0, 4.5, 8.0]
for d in diem:
    if d < 5:
        continue        # bỏ qua môn chưa đạt
    print(d)
${F}

Cần cả vị trí lẫn giá trị thì dùng **enumerate(diem)**.

## while
Dùng khi chưa biết trước số lần lặp, ví dụ yêu cầu nhập lại đến khi hợp lệ:

${F}python
while True:
    tuoi = int(input("Tuổi (1-120): "))
    if 1 <= tuoi <= 120:
        break
    print("Không hợp lệ, mời nhập lại.")
${F}

> Lỗi hay gặp: quên cập nhật biến điều kiện trong **while** làm chương trình lặp vô hạn. Nhấn Ctrl+C để dừng.`,
          ],
        ],
        quiz: [
          one(
            "Python xác định khối lệnh của if bằng cách nào?",
            ["Cặp ngoặc nhọn { }", "Từ khóa begin / end", "Thụt lề", "Dấu chấm phẩy"],
            2,
            "Các dòng thụt lề cùng mức tạo thành một khối lệnh.",
          ),
          one(
            "range(2, 10, 3) sinh ra dãy nào?",
            ["2, 5, 8", "2, 5, 8, 11", "3, 6, 9", "2, 3, 4"],
            0,
            "Bắt đầu từ 2, bước 3, dừng trước 10.",
          ),
          tf(
            "Lệnh continue kết thúc hẳn vòng lặp đang chạy.",
            false,
            "continue chỉ bỏ qua phần còn lại của lần lặp hiện tại; break mới thoát khỏi vòng lặp.",
          ),
        ],
      },
      {
        title: "Chương 3: Hàm và cấu trúc dữ liệu",
        lessons: [
          [
            "Bài 5: Định nghĩa và sử dụng hàm",
            `# Định nghĩa và sử dụng hàm

## Mục tiêu
- Viết hàm có tham số, giá trị mặc định và giá trị trả về.
- Hiểu phạm vi của biến cục bộ.

## Vì sao cần hàm?
Hàm gom một việc thành một cái tên. Chương trình ngắn hơn, dễ đọc hơn, và khi sửa chỉ phải sửa một chỗ.

${F}python
def diem_trung_binh(diem, he_so=None):
    """Trả về điểm trung bình, có hệ số nếu được truyền vào."""
    if he_so is None:
        return sum(diem) / len(diem)
    tong = sum(d * h for d, h in zip(diem, he_so))
    return tong / sum(he_so)

print(diem_trung_binh([8, 6, 9]))             # 7.666...
print(diem_trung_binh([8, 6, 9], [3, 2, 4]))  # 8.0
${F}

## return khác print
**print** chỉ hiển thị ra màn hình. **return** trả giá trị về cho nơi gọi để tính tiếp. Hàm không có return sẽ trả về **None**.

## Phạm vi biến
Biến tạo trong hàm là biến cục bộ, hàm chạy xong là mất. Đừng dựa vào biến toàn cục: hãy truyền dữ liệu qua tham số và nhận kết quả qua return.

## Thói quen tốt
1. Mỗi hàm làm một việc, tên là động từ: **tinh_hoc_phi**, **doc_danh_sach**.
2. Viết docstring một dòng mô tả hàm trả về gì.
3. Hàm dài quá một màn hình thì tách nhỏ.`,
          ],
          [
            "Bài 6: List, dict và đọc ghi tệp",
            `# List, dict và đọc ghi tệp

## Mục tiêu
- Chọn đúng cấu trúc: **list** cho dãy có thứ tự, **dict** cho tra cứu theo khóa.
- Đọc và ghi tệp văn bản an toàn bằng **with**.

## List
${F}python
lop = ["An", "Bình", "Chi"]
lop.append("Dũng")        # thêm cuối
lop.sort()                # sắp xếp tại chỗ
print(lop[0], len(lop))
ten_dai = [t for t in lop if len(t) > 2]   # list comprehension
${F}

## Dict
Dict lưu cặp khóa - giá trị, tra cứu theo khóa rất nhanh.

${F}python
diem = {"An": 8.5, "Bình": 6.0}
diem["Chi"] = 9.0
print(diem.get("Dũng", 0))      # 0, không báo lỗi khi thiếu khóa
for ten, d in diem.items():
    print(ten, d)
${F}

## Đọc ghi tệp
Luôn mở tệp bằng **with** để tệp tự đóng kể cả khi có lỗi, và ghi rõ **encoding="utf-8"** để không vỡ dấu tiếng Việt.

${F}python
with open("diem.txt", encoding="utf-8") as tep:
    for dong in tep:
        ten, d = dong.strip().split(",")
        diem[ten] = float(d)

with open("ket_qua.txt", "w", encoding="utf-8") as tep:
    for ten, d in sorted(diem.items()):
        tep.write(f"{ten}: {d:.1f}\\n")
${F}

> Chế độ "w" ghi đè toàn bộ tệp cũ. Muốn ghi nối thêm thì dùng "a".`,
          ],
        ],
        quiz: [
          one(
            "Một hàm Python không có câu lệnh return sẽ trả về giá trị gì?",
            ["0", "Chuỗi rỗng", "None", "Báo lỗi"],
            2,
            "Hàm kết thúc mà không gặp return thì trả về None.",
          ),
          many(
            "Những phát biểu nào đúng về dict?",
            [
              "Tra cứu theo khóa",
              "Khóa có thể trùng nhau",
              "get() cho phép đặt giá trị mặc định khi thiếu khóa",
              "items() trả về các cặp khóa - giá trị",
            ],
            [0, 2, 3],
            "Khóa trong dict là duy nhất; gán lại cùng khóa sẽ ghi đè giá trị cũ.",
          ),
          tf(
            'Mở tệp ở chế độ "w" sẽ giữ nguyên nội dung cũ và ghi nối vào cuối.',
            false,
            'Chế độ "w" xóa nội dung cũ; chế độ "a" mới ghi nối vào cuối.',
          ),
        ],
      },
    ],
  },
  {
    code: "DB-201",
    title: "Cơ sở dữ liệu và SQL thực hành",
    description:
      "Từ mô hình quan hệ đến truy vấn nhiều bảng. Sau khóa học bạn thiết kế được lược đồ đạt chuẩn 3NF, viết được SELECT có JOIN, GROUP BY, và hiểu khi nào cần chỉ mục, giao dịch. Ví dụ xuyên suốt là cơ sở dữ liệu quản lý sinh viên. Thời lượng khoảng 7 giờ tự học.",
    chapters: [
      {
        title: "Chương 1: Mô hình quan hệ",
        lessons: [
          [
            "Bài 1: Bảng, khóa chính và khóa ngoại",
            `# Bảng, khóa chính và khóa ngoại

## Mục tiêu
- Mô tả dữ liệu bằng bảng, cột và dòng.
- Giải thích vai trò của khóa chính và khóa ngoại.

## Mô hình quan hệ
Dữ liệu được tổ chức thành các **bảng**. Mỗi dòng là một thực thể (một sinh viên), mỗi cột là một thuộc tính (họ tên, ngày sinh).

${F}sql
CREATE TABLE khoa (
  ma_khoa  varchar(10) PRIMARY KEY,
  ten_khoa varchar(100) NOT NULL
);

CREATE TABLE sinh_vien (
  ma_sv     char(8) PRIMARY KEY,
  ho_ten    varchar(100) NOT NULL,
  ngay_sinh date,
  ma_khoa   varchar(10) NOT NULL REFERENCES khoa(ma_khoa)
);
${F}

## Khóa chính (PRIMARY KEY)
Là cột (hoặc nhóm cột) xác định duy nhất một dòng: không trùng, không rỗng. Nên chọn giá trị **không bao giờ thay đổi**, ví dụ mã sinh viên chứ không phải số điện thoại.

## Khóa ngoại (FOREIGN KEY)
Là cột tham chiếu đến khóa chính của bảng khác. Hệ quản trị sẽ từ chối:
- thêm sinh viên có **ma_khoa** không tồn tại trong bảng khoa;
- xóa một khoa khi vẫn còn sinh viên thuộc khoa đó (trừ khi khai báo ON DELETE CASCADE).

Đây gọi là **toàn vẹn tham chiếu**: cơ sở dữ liệu tự bảo vệ để không có dữ liệu mồ côi.

## Ràng buộc khác
- **NOT NULL**: bắt buộc có giá trị.
- **UNIQUE**: không trùng (ví dụ email).
- **CHECK**: điều kiện tùy ý, ví dụ điểm nằm trong khoảng 0 đến 10.`,
          ],
          [
            "Bài 2: Chuẩn hóa dữ liệu đến 3NF",
            `# Chuẩn hóa dữ liệu đến 3NF

## Mục tiêu
- Nhận ra dữ liệu lặp và các dị thường khi cập nhật.
- Tách bảng đạt dạng chuẩn 1NF, 2NF, 3NF.

## Vấn đề của bảng "gom tất cả"
Giả sử lưu điểm trong một bảng duy nhất: mã SV, họ tên, mã môn, tên môn, số tín chỉ, điểm. Tên môn học lặp lại ở mọi dòng. Hệ quả:
- **Dị thường cập nhật**: đổi tên môn phải sửa hàng trăm dòng, sót một dòng là dữ liệu mâu thuẫn.
- **Dị thường thêm**: chưa có sinh viên đăng ký thì không lưu được môn mới.
- **Dị thường xóa**: xóa sinh viên cuối cùng của môn là mất luôn thông tin môn.

## Ba dạng chuẩn
1. **1NF**: mỗi ô chỉ chứa một giá trị, không có cột lặp kiểu sdt1, sdt2.
2. **2NF**: đạt 1NF và mọi cột không khóa phụ thuộc vào **toàn bộ** khóa chính. Với khóa (ma_sv, ma_mon), tên môn chỉ phụ thuộc ma_mon nên phải tách ra.
3. **3NF**: đạt 2NF và không có cột không khóa phụ thuộc vào cột không khóa khác. Ví dụ tên khoa phụ thuộc mã khoa, không phụ thuộc trực tiếp mã sinh viên.

## Kết quả sau khi tách
- **sinh_vien**(ma_sv, ho_ten, ma_khoa)
- **mon_hoc**(ma_mon, ten_mon, so_tin_chi)
- **ket_qua**(ma_sv, ma_mon, diem) với khóa chính gồm hai cột

> Câu nhớ nhanh: mỗi sự thật chỉ lưu ở một nơi.`,
          ],
        ],
        quiz: [
          one(
            "Tính chất nào bắt buộc với khóa chính?",
            [
              "Phải là số nguyên tự tăng",
              "Duy nhất và không rỗng",
              "Phải gồm đúng một cột",
              "Phải là chuỗi",
            ],
            1,
            "Khóa chính xác định duy nhất mỗi dòng nên không được trùng và không được NULL.",
          ),
          tf(
            "Khóa ngoại giúp ngăn việc thêm sinh viên thuộc một khoa không tồn tại.",
            true,
            "Đó chính là toàn vẹn tham chiếu.",
          ),
          one(
            "Bảng ket_qua(ma_sv, ma_mon, ten_mon, diem) vi phạm dạng chuẩn nào?",
            ["1NF", "2NF", "Không vi phạm", "Chỉ vi phạm BCNF"],
            1,
            "ten_mon chỉ phụ thuộc ma_mon, tức một phần của khóa chính, nên vi phạm 2NF.",
          ),
        ],
      },
      {
        title: "Chương 2: Truy vấn dữ liệu",
        lessons: [
          [
            "Bài 3: SELECT, WHERE và sắp xếp",
            `# SELECT, WHERE và sắp xếp

## Mục tiêu
- Lọc dòng bằng WHERE với các toán tử thông dụng.
- Sắp xếp và giới hạn kết quả.

## Cấu trúc cơ bản
${F}sql
SELECT ma_sv, ho_ten, ngay_sinh
FROM sinh_vien
WHERE ma_khoa = 'CNTT' AND ngay_sinh >= '2004-01-01'
ORDER BY ho_ten
LIMIT 20;
${F}

Chỉ liệt kê những cột cần dùng. \`SELECT *\` tiện khi thử nghiệm nhưng làm truy vấn chậm và dễ hỏng khi bảng thêm cột.

## Toán tử trong WHERE
- So sánh: **=**, **<>**, **<**, **>=**.
- **BETWEEN a AND b**: trong khoảng, tính cả hai đầu.
- **IN ('CNTT', 'QTKD')**: thuộc một danh sách.
- **LIKE 'Nguyễn%'**: khớp mẫu, % là chuỗi bất kỳ, _ là một ký tự.
- **IS NULL**: kiểm tra rỗng.

> NULL nghĩa là "không biết". So sánh **cot = NULL** luôn cho kết quả không xác định, phải viết **cot IS NULL**.

## Sắp xếp
**ORDER BY diem DESC, ho_ten ASC**: giảm dần theo điểm, trùng điểm thì theo tên. Không có ORDER BY thì thứ tự kết quả **không được đảm bảo**.

## Loại bỏ trùng lặp
${F}sql
SELECT DISTINCT ma_khoa FROM sinh_vien;
${F}`,
          ],
          [
            "Bài 4: JOIN và GROUP BY",
            `# JOIN và GROUP BY

## Mục tiêu
- Ghép dữ liệu từ nhiều bảng bằng INNER JOIN và LEFT JOIN.
- Tổng hợp theo nhóm với GROUP BY và HAVING.

## INNER JOIN
Chỉ trả về những dòng khớp ở cả hai bảng.

${F}sql
SELECT sv.ho_ten, mh.ten_mon, kq.diem
FROM ket_qua kq
JOIN sinh_vien sv ON sv.ma_sv = kq.ma_sv
JOIN mon_hoc mh ON mh.ma_mon = kq.ma_mon;
${F}

## LEFT JOIN
Giữ **mọi dòng của bảng bên trái**, kể cả khi không có dòng khớp; các cột bên phải khi đó là NULL. Dùng để tìm "những thứ chưa có":

${F}sql
-- Sinh viên chưa có điểm môn nào
SELECT sv.ma_sv, sv.ho_ten
FROM sinh_vien sv
LEFT JOIN ket_qua kq ON kq.ma_sv = sv.ma_sv
WHERE kq.ma_sv IS NULL;
${F}

## Hàm tổng hợp và GROUP BY
**COUNT**, **SUM**, **AVG**, **MIN**, **MAX** gộp nhiều dòng thành một giá trị cho mỗi nhóm.

${F}sql
SELECT sv.ma_khoa, COUNT(*) AS so_sv, ROUND(AVG(kq.diem), 2) AS diem_tb
FROM sinh_vien sv
JOIN ket_qua kq ON kq.ma_sv = sv.ma_sv
GROUP BY sv.ma_khoa
HAVING AVG(kq.diem) >= 7
ORDER BY diem_tb DESC;
${F}

## WHERE khác HAVING
- **WHERE** lọc từng dòng **trước** khi gom nhóm.
- **HAVING** lọc các nhóm **sau** khi đã tổng hợp, nên mới dùng được AVG, COUNT.`,
          ],
        ],
        quiz: [
          one(
            "Điều kiện nào tìm đúng các dòng có cột email chưa có giá trị?",
            ["email = NULL", "email == ''", "email IS NULL", "email <> NULL"],
            2,
            "NULL phải được kiểm tra bằng IS NULL; so sánh bằng = luôn cho kết quả không xác định.",
          ),
          one(
            "Muốn liệt kê cả những sinh viên chưa có điểm nào, cần dùng phép ghép nào từ bảng sinh_vien?",
            ["INNER JOIN", "LEFT JOIN", "CROSS JOIN", "Không cần JOIN"],
            1,
            "LEFT JOIN giữ mọi dòng của bảng bên trái dù không có dòng khớp.",
          ),
          tf(
            "HAVING được áp dụng trước khi các dòng được gom nhóm.",
            false,
            "WHERE lọc trước khi gom nhóm; HAVING lọc sau khi đã tổng hợp.",
          ),
        ],
      },
      {
        title: "Chương 3: Hiệu năng và an toàn dữ liệu",
        lessons: [
          [
            "Bài 5: Chỉ mục (index)",
            `# Chỉ mục (index)

## Mục tiêu
- Giải thích vì sao chỉ mục làm truy vấn nhanh hơn.
- Biết khi nào nên và không nên tạo chỉ mục.

## Chỉ mục hoạt động thế nào?
Không có chỉ mục, để tìm sinh viên theo email hệ quản trị phải đọc **toàn bộ bảng** (sequential scan). Chỉ mục giống mục lục cuối sách: một cấu trúc cây B-tree đã sắp xếp, cho phép tìm một giá trị trong vài bước dù bảng có hàng triệu dòng.

${F}sql
CREATE INDEX sinh_vien_email_idx ON sinh_vien(email);
CREATE INDEX ket_qua_mon_diem_idx ON ket_qua(ma_mon, diem);
${F}

## Nên tạo khi
- Cột thường xuất hiện trong **WHERE**, **JOIN ... ON** hoặc **ORDER BY**.
- Cột khóa ngoại: nhiều hệ quản trị không tự tạo chỉ mục cho khóa ngoại.

## Cái giá phải trả
- Mỗi lần INSERT, UPDATE, DELETE đều phải cập nhật chỉ mục nên **ghi chậm hơn**.
- Tốn thêm dung lượng đĩa.
- Cột ít giá trị khác nhau (giới tính, trạng thái) hầu như không được lợi.

## Chỉ mục nhiều cột
Thứ tự cột quan trọng: chỉ mục (ma_mon, diem) dùng được cho điều kiện theo ma_mon, hoặc ma_mon kèm diem, nhưng **không** giúp truy vấn chỉ lọc theo diem.

## Kiểm chứng bằng EXPLAIN
${F}sql
EXPLAIN ANALYZE SELECT * FROM sinh_vien WHERE email = 'an@tdtu.edu.vn';
${F}
Đọc kế hoạch thực thi để biết truy vấn dùng Index Scan hay Seq Scan trước khi quyết định thêm chỉ mục.`,
          ],
          [
            "Bài 6: Giao dịch và tính chất ACID",
            `# Giao dịch và tính chất ACID

## Mục tiêu
- Dùng BEGIN, COMMIT, ROLLBACK để gom nhiều lệnh thành một đơn vị.
- Trình bày bốn tính chất ACID.

## Vì sao cần giao dịch?
Chuyển 500.000 đồng học phí từ ví A sang ví B gồm hai lệnh: trừ A và cộng B. Nếu hệ thống sập giữa chừng, tiền biến mất. Giao dịch đảm bảo **hoặc cả hai lệnh thành công, hoặc không lệnh nào có hiệu lực**.

${F}sql
BEGIN;
UPDATE vi SET so_du = so_du - 500000 WHERE ma_sv = '52100001';
UPDATE vi SET so_du = so_du + 500000 WHERE ma_sv = '52100002';
COMMIT;      -- hoặc ROLLBACK; để hủy toàn bộ
${F}

## ACID
- **Atomicity (nguyên tử)**: tất cả hoặc không gì cả.
- **Consistency (nhất quán)**: dữ liệu luôn thỏa mọi ràng buộc trước và sau giao dịch.
- **Isolation (cô lập)**: các giao dịch chạy đồng thời không nhìn thấy trạng thái dở dang của nhau.
- **Durability (bền vững)**: đã COMMIT thì không mất, kể cả khi mất điện ngay sau đó.

## Thực hành tốt
1. Giữ giao dịch **ngắn**: không chờ người dùng nhập liệu giữa BEGIN và COMMIT, vì các dòng đang bị khóa.
2. Luôn xử lý lỗi: gặp lỗi thì ROLLBACK.
3. Không nối chuỗi để tạo câu SQL từ dữ liệu người dùng. Dùng **tham số** ($1, $2) để tránh SQL injection.`,
          ],
        ],
        quiz: [
          many(
            "Những nhận định nào đúng về chỉ mục?",
            [
              "Giúp tìm kiếm theo cột được đánh chỉ mục nhanh hơn",
              "Làm các thao tác ghi chậm hơn một chút",
              "Luôn nên tạo cho mọi cột",
              "Tốn thêm dung lượng lưu trữ",
            ],
            [0, 1, 3],
            "Chỉ mục có chi phí ghi và lưu trữ nên chỉ tạo cho cột thực sự được dùng để lọc, ghép hoặc sắp xếp.",
          ),
          one(
            "Chữ A trong ACID có nghĩa là gì?",
            [
              "Availability - luôn sẵn sàng",
              "Atomicity - tất cả hoặc không gì cả",
              "Accuracy - chính xác",
              "Authorization - phân quyền",
            ],
            1,
            "Atomicity: mọi lệnh trong giao dịch cùng thành công hoặc cùng bị hủy.",
          ),
          tf(
            "Chỉ mục trên (ma_mon, diem) giúp tăng tốc truy vấn chỉ lọc theo cột diem.",
            false,
            "Chỉ mục nhiều cột chỉ dùng được khi điều kiện có cột đứng đầu.",
          ),
        ],
      },
    ],
  },
  {
    code: "GIT-101",
    title: "Git và làm việc nhóm trên GitHub",
    description:
      "Quản lý mã nguồn cho đồ án nhóm một cách bài bản. Sau khóa học bạn tự tin commit, tạo nhánh, gộp nhánh, xử lý xung đột và làm việc qua pull request. Phù hợp với sinh viên chuẩn bị làm đồ án và nhân viên mới vào dự án phần mềm. Thời lượng khoảng 5 giờ tự học.",
    chapters: [
      {
        title: "Chương 1: Nền tảng Git",
        lessons: [
          [
            "Bài 1: Kho chứa, commit và ba vùng làm việc",
            `# Kho chứa, commit và ba vùng làm việc

## Mục tiêu
- Hiểu Git lưu lịch sử như thế nào.
- Thực hiện vòng lặp cơ bản: sửa, add, commit.

## Git giải quyết vấn đề gì?
Thay vì các thư mục "do_an_final", "do_an_final_2", Git ghi lại **từng ảnh chụp** (commit) của dự án kèm người sửa, thời điểm và lý do. Bạn quay lại bất kỳ thời điểm nào và biết chính xác dòng nào thay đổi.

## Ba vùng
1. **Working directory**: các tệp bạn đang sửa.
2. **Staging area**: những thay đổi đã chọn cho commit tiếp theo.
3. **Repository**: lịch sử các commit, nằm trong thư mục .git.

${F}bash
git init                     # tạo kho chứa
git status                   # xem tệp nào đã đổi
git add src/login.py         # đưa vào staging
git commit -m "Thêm kiểm tra mật khẩu khi đăng nhập"
git log --oneline            # xem lịch sử gọn
${F}

## Viết thông điệp commit
- Dòng đầu dưới 70 ký tự, nói **thay đổi gì và vì sao**, không phải "sửa lỗi" hay "update".
- Mỗi commit một việc. Sửa lỗi đăng nhập và đổi màu nút là hai commit.

## Tệp không nên đưa vào Git
Khai báo trong tệp **.gitignore**: thư mục node_modules, tệp build, và đặc biệt là tệp **.env** chứa mật khẩu, khóa API.

> Một khi mật khẩu đã lọt vào lịch sử commit và được đẩy lên, hãy coi như nó đã lộ và đổi ngay.`,
          ],
          [
            "Bài 2: Xem lại và hoàn tác thay đổi",
            `# Xem lại và hoàn tác thay đổi

## Mục tiêu
- Xem khác biệt giữa các phiên bản.
- Chọn đúng lệnh hoàn tác cho từng tình huống.

## Xem thay đổi
${F}bash
git diff                 # thay đổi chưa add
git diff --staged        # thay đổi đã add, chưa commit
git show a1b2c3d         # nội dung một commit
git blame src/login.py   # ai sửa dòng nào, ở commit nào
${F}

## Hoàn tác theo tình huống
- **Sửa nhầm tệp, chưa add**: git restore ten_tep (mất thay đổi chưa lưu, không lấy lại được).
- **Đã add nhầm**: git restore --staged ten_tep (chỉ bỏ khỏi staging, nội dung giữ nguyên).
- **Commit cuối sai thông điệp hoặc thiếu tệp, chưa đẩy lên**: git commit --amend.
- **Commit đã đẩy lên máy chủ**: git revert ma_commit. Lệnh này tạo một commit **mới** đảo ngược thay đổi, lịch sử cũ vẫn nguyên.

## Vì sao không sửa lịch sử đã chia sẻ?
Các lệnh như **reset --hard** hay **rebase** viết lại lịch sử. Nếu đồng đội đã kéo các commit đó về, kho của họ sẽ lệch với máy chủ và phải xử lý rất vất vả. Quy tắc: **chỉ viết lại lịch sử chưa đẩy lên**.

## Cất tạm công việc
${F}bash
git stash          # cất thay đổi dở dang
git stash pop      # lấy lại
${F}
Hữu ích khi đang làm dở mà cần chuyển nhánh để sửa lỗi gấp.`,
          ],
        ],
        quiz: [
          one(
            "Lệnh nào đưa thay đổi của một tệp vào staging area?",
            ["git commit", "git add", "git push", "git status"],
            1,
            "git add chọn thay đổi cho commit tiếp theo.",
          ),
          one(
            "Một commit lỗi đã được đẩy lên nhánh chung. Cách hoàn tác an toàn nhất là gì?",
            [
              "git reset --hard rồi push --force",
              "git revert",
              "Xóa kho chứa và tạo lại",
              "git stash",
            ],
            1,
            "git revert tạo commit mới đảo ngược thay đổi, không viết lại lịch sử mà đồng đội đã kéo về.",
          ),
          tf(
            "Tệp .env chứa mật khẩu nên được commit để cả nhóm dùng chung.",
            false,
            "Tệp bí mật phải nằm trong .gitignore; chia sẻ qua kênh riêng hoặc trình quản lý bí mật.",
          ),
        ],
      },
      {
        title: "Chương 2: Nhánh và gộp nhánh",
        lessons: [
          [
            "Bài 3: Tạo nhánh và gộp nhánh",
            `# Tạo nhánh và gộp nhánh

## Mục tiêu
- Tạo nhánh riêng cho từng tính năng.
- Phân biệt gộp fast-forward và gộp có merge commit.

## Nhánh là gì?
Nhánh chỉ là một **con trỏ** tới một commit, nên tạo nhánh trong Git gần như tức thì. Mỗi tính năng làm trên một nhánh riêng để nhánh chính luôn chạy được.

${F}bash
git switch -c tinh-nang/dang-ky-mon   # tạo và chuyển sang nhánh mới
# ... sửa, add, commit ...
git switch main
git merge tinh-nang/dang-ky-mon
git branch -d tinh-nang/dang-ky-mon   # xóa nhánh đã gộp
${F}

## Hai kiểu gộp
- **Fast-forward**: nhánh main chưa có commit mới từ lúc tách nhánh, Git chỉ dời con trỏ main lên. Lịch sử thẳng.
- **Merge commit**: cả hai nhánh đều có commit mới, Git tạo một commit có hai cha để nối chúng lại.

## Đặt tên nhánh
Dùng tiền tố thể hiện loại việc: **tinh-nang/**, **sua-loi/**, **tai-lieu/**, theo sau là mô tả ngắn. Tránh tên như "test" hay "nhanh-cua-an".

## Giữ nhánh ngắn ngày
Nhánh sống càng lâu càng lệch xa main và càng dễ xung đột. Chia việc nhỏ, gộp sớm, mỗi nhánh vài ngày là lý tưởng.`,
          ],
          [
            "Bài 4: Xử lý xung đột khi gộp",
            `# Xử lý xung đột khi gộp

## Mục tiêu
- Đọc hiểu dấu đánh dấu xung đột.
- Giải quyết xung đột và hoàn tất lệnh gộp.

## Khi nào xảy ra xung đột?
Khi hai nhánh cùng sửa **một vùng của cùng một tệp** theo hai cách khác nhau. Git không đoán được ý ai đúng nên dừng lại để bạn quyết định. Sửa hai tệp khác nhau, hoặc hai chỗ xa nhau trong một tệp, thì Git tự gộp được.

## Dấu đánh dấu
${F}text
<<<<<<< HEAD
hoc_phi = so_tin_chi * 650000
=======
hoc_phi = so_tin_chi * don_gia(khoa)
>>>>>>> tinh-nang/hoc-phi-theo-khoa
${F}

Phần trên dấu ======= là nội dung của nhánh hiện tại, phần dưới là của nhánh đang gộp vào.

## Các bước xử lý
1. Chạy **git status** để xem danh sách tệp xung đột.
2. Mở từng tệp, quyết định giữ bên nào hoặc viết lại kết hợp cả hai, rồi **xóa hết ba dòng đánh dấu**.
3. Chạy lại chương trình và kiểm thử.
4. **git add** các tệp đã sửa, rồi **git commit** để hoàn tất.

Muốn bỏ dở và quay lại trước khi gộp: **git merge --abort**.

## Giảm xung đột
- Kéo main về nhánh của mình thường xuyên.
- Không định dạng lại cả tệp trong cùng commit với thay đổi logic.
- Trao đổi với đồng đội khi hai người cần sửa cùng một tệp lớn.

> Hỏi người viết phần kia trước khi xóa mã của họ. Xung đột là vấn đề giao tiếp nhiều hơn là vấn đề kỹ thuật.`,
          ],
        ],
        quiz: [
          tf(
            "Trong Git, một nhánh thực chất là một con trỏ tới một commit.",
            true,
            "Vì vậy tạo và xóa nhánh rất nhẹ.",
          ),
          one(
            "Xung đột khi gộp xảy ra trong trường hợp nào?",
            [
              "Hai nhánh sửa hai tệp khác nhau",
              "Hai nhánh sửa cùng một vùng của cùng một tệp",
              "Nhánh có quá nhiều commit",
              "Quên chạy git pull",
            ],
            1,
            "Git chỉ không tự gộp được khi cùng một vùng bị sửa theo hai cách.",
          ),
          one(
            "Lệnh nào hủy lệnh gộp đang dở và đưa kho về trạng thái trước khi gộp?",
            ["git merge --abort", "git revert", "git branch -d", "git stash pop"],
            0,
            "git merge --abort bỏ toàn bộ quá trình gộp đang xung đột.",
          ),
        ],
      },
      {
        title: "Chương 3: Cộng tác trên GitHub",
        lessons: [
          [
            "Bài 5: Remote, push và pull",
            `# Remote, push và pull

## Mục tiêu
- Kết nối kho cục bộ với kho trên GitHub.
- Đồng bộ thay đổi hai chiều.

## Remote là gì?
Remote là một bản sao của kho chứa đặt trên máy chủ. Tên mặc định là **origin**.

${F}bash
git clone https://github.com/nhom-7/do-an.git   # tải kho về lần đầu
git remote -v                                   # xem remote đang cấu hình
git push -u origin tinh-nang/dang-ky-mon        # đẩy nhánh lên lần đầu
git pull                                        # lấy và gộp thay đổi mới
${F}

## fetch khác pull
- **git fetch** chỉ tải commit mới về, chưa động vào nhánh của bạn. An toàn để xem đồng đội đã làm gì.
- **git pull** bằng fetch cộng với merge vào nhánh hiện tại.

## Khi push bị từ chối
Thông báo "rejected ... fetch first" nghĩa là máy chủ có commit mà bạn chưa có. Cách xử lý: **git pull**, giải quyết xung đột nếu có, rồi push lại. **Không** dùng push --force trên nhánh chung, vì nó xóa commit của người khác.

## Thói quen hằng ngày
1. Bắt đầu buổi làm việc: git switch main, git pull.
2. Tạo nhánh mới từ main vừa cập nhật.
3. Commit nhỏ, push thường xuyên để có bản sao lưu trên máy chủ.`,
          ],
          [
            "Bài 6: Pull request và review mã",
            `# Pull request và review mã

## Mục tiêu
- Mở pull request có mô tả rõ ràng.
- Review mã của đồng đội một cách xây dựng.

## Quy trình
1. Đẩy nhánh tính năng lên GitHub.
2. Mở **pull request (PR)** từ nhánh đó vào main.
3. Kiểm thử tự động (CI) chạy; đồng đội đọc và nhận xét.
4. Sửa theo góp ý bằng các commit mới trên cùng nhánh.
5. Được chấp thuận thì gộp, rồi xóa nhánh.

## Một PR tốt
- **Nhỏ**: dưới khoảng 400 dòng thay đổi. PR lớn thường được duyệt qua loa.
- **Tiêu đề** nói rõ thay đổi; **mô tả** gồm: vì sao cần, đã làm gì, cách kiểm thử, ảnh chụp màn hình nếu có giao diện.
- Liên kết tới công việc liên quan, ví dụ "Closes #42".

## Review thế nào cho hiệu quả
- Đọc để **hiểu** trước khi góp ý. Chạy thử nếu thay đổi quan trọng.
- Nhận xét vào mã, không vào người: "Hàm này sẽ lỗi khi danh sách rỗng" thay vì "Bạn viết ẩu".
- Phân biệt góp ý bắt buộc và gợi ý tùy chọn.
- Khen những chỗ làm tốt.

## Bảo vệ nhánh chính
Bật **branch protection** cho main: bắt buộc qua PR, ít nhất một người duyệt và CI phải xanh. Nhờ vậy không ai vô tình đẩy thẳng mã lỗi vào nhánh chung.`,
          ],
        ],
        quiz: [
          one(
            "Khác biệt chính giữa git fetch và git pull là gì?",
            [
              "fetch tải về và gộp, pull chỉ tải về",
              "fetch chỉ tải về, pull tải về rồi gộp vào nhánh hiện tại",
              "Hai lệnh giống hệt nhau",
              "fetch đẩy mã lên máy chủ",
            ],
            1,
            "pull = fetch + merge.",
          ),
          tf(
            "Khi push bị từ chối trên nhánh chung, nên dùng git push --force để ghi đè.",
            false,
            "push --force xóa commit của người khác; hãy pull, xử lý xung đột rồi push lại.",
          ),
          many(
            "Những đặc điểm nào thuộc về một pull request tốt?",
            [
              "Thay đổi nhỏ, tập trung một việc",
              "Mô tả lý do và cách kiểm thử",
              "Gộp càng nhiều tính năng càng tốt để đỡ phải review nhiều lần",
              "Có liên kết tới công việc liên quan",
            ],
            [0, 1, 3],
            "PR lớn và ôm nhiều việc khó review kỹ và dễ lọt lỗi.",
          ),
        ],
      },
    ],
  },
  {
    code: "NET-201",
    title: "Mạng máy tính và thoại VoIP căn bản",
    description:
      "Hiểu đường đi của dữ liệu từ trình duyệt đến máy chủ và cách một cuộc gọi qua Internet được thiết lập. Sau khóa học bạn đọc được địa chỉ IP, phân biệt TCP và UDP, giải thích được SIP, RTP và các chỉ số chất lượng thoại như jitter, mất gói, MOS. Thời lượng khoảng 6 giờ tự học.",
    chapters: [
      {
        title: "Chương 1: Nền tảng mạng",
        lessons: [
          [
            "Bài 1: Mô hình phân tầng TCP/IP",
            `# Mô hình phân tầng TCP/IP

## Mục tiêu
- Kể tên bốn tầng của mô hình TCP/IP và vai trò từng tầng.
- Mô tả quá trình đóng gói dữ liệu.

## Vì sao phải phân tầng?
Truyền dữ liệu là bài toán lớn. Chia thành các tầng giúp mỗi tầng giải quyết một việc và có thể thay thế độc lập: đổi từ cáp sang Wi-Fi mà trình duyệt không cần biết.

## Bốn tầng
1. **Ứng dụng**: giao thức mà chương trình dùng, như HTTP, DNS, SIP.
2. **Giao vận**: chuyển dữ liệu giữa hai **tiến trình**, phân biệt bằng số cổng. Gồm TCP và UDP.
3. **Internet**: định tuyến gói tin giữa hai **máy** qua nhiều mạng, dùng địa chỉ IP.
4. **Liên kết**: truyền khung dữ liệu trong một mạng cục bộ, như Ethernet, Wi-Fi, dùng địa chỉ MAC.

## Đóng gói
Khi gửi, dữ liệu đi từ tầng trên xuống; mỗi tầng thêm **phần đầu (header)** của mình:

${F}text
[ Ethernet | IP | TCP | HTTP: GET /index.html ]
${F}

Bên nhận làm ngược lại: mỗi tầng đọc và bóc header của mình rồi chuyển phần còn lại lên trên.

## Thiết bị tương ứng
- **Switch** làm việc ở tầng liên kết, chuyển khung theo địa chỉ MAC.
- **Router** làm việc ở tầng Internet, chuyển gói theo địa chỉ IP.

> So sánh với OSI: mô hình OSI có 7 tầng; ba tầng trên cùng của OSI gộp lại thành tầng ứng dụng của TCP/IP.`,
          ],
          [
            "Bài 2: Địa chỉ IP, mạng con và NAT",
            `# Địa chỉ IP, mạng con và NAT

## Mục tiêu
- Đọc được địa chỉ IPv4 kèm tiền tố mạng.
- Giải thích NAT và ảnh hưởng của nó tới ứng dụng thời gian thực.

## Địa chỉ IPv4
Gồm 32 bit, viết thành bốn số từ 0 đến 255, ví dụ 192.168.1.25. Ký hiệu **/24** cho biết 24 bit đầu là phần mạng, 8 bit còn lại là phần máy.

- Mạng 192.168.1.0/24 có 256 địa chỉ, dùng được 254 cho máy (trừ địa chỉ mạng và địa chỉ quảng bá).
- Hai máy cùng phần mạng nói chuyện trực tiếp; khác mạng thì phải qua **gateway** (router).

## Địa chỉ riêng
Ba dải chỉ dùng trong mạng nội bộ, không định tuyến trên Internet:
- 10.0.0.0/8
- 172.16.0.0/12
- 192.168.0.0/16

## NAT
Router ở nhà hay ở trường chỉ có một địa chỉ công khai. **NAT** thay địa chỉ riêng của máy bên trong bằng địa chỉ công khai của router khi gói tin đi ra, và ghi nhớ ánh xạ cổng để chuyển gói trả lời về đúng máy.

## NAT gây khó gì?
Máy bên ngoài **không chủ động kết nối vào** được máy sau NAT. Điều này ảnh hưởng tới gọi thoại và họp trực tuyến, vốn cần hai bên gửi dữ liệu trực tiếp cho nhau. Giải pháp:
- **STUN**: giúp máy biết địa chỉ công khai của chính mình.
- **TURN**: máy chủ trung chuyển khi không thể kết nối trực tiếp, ví dụ sau tường lửa chặt hoặc mạng 4G.

## DNS
Con người nhớ tên miền, máy cần địa chỉ IP. DNS là hệ thống tra cứu tên miền ra địa chỉ.`,
          ],
        ],
        quiz: [
          one(
            "Tầng nào chịu trách nhiệm định tuyến gói tin giữa các mạng bằng địa chỉ IP?",
            ["Ứng dụng", "Giao vận", "Internet", "Liên kết"],
            2,
            "Tầng Internet dùng địa chỉ IP để chuyển gói qua nhiều mạng.",
          ),
          one(
            "Mạng 192.168.10.0/24 có bao nhiêu địa chỉ dùng được cho máy?",
            ["256", "254", "255", "128"],
            1,
            "8 bit phần máy cho 256 địa chỉ, trừ địa chỉ mạng và địa chỉ quảng bá còn 254.",
          ),
          tf(
            "Máy chủ TURN trung chuyển dữ liệu khi hai máy không thể kết nối trực tiếp với nhau.",
            true,
            "TURN là phương án dự phòng khi NAT hoặc tường lửa chặn kết nối trực tiếp.",
          ),
        ],
      },
      {
        title: "Chương 2: Tầng giao vận",
        lessons: [
          [
            "Bài 3: TCP - truyền tin cậy",
            `# TCP - truyền tin cậy

## Mục tiêu
- Mô tả bắt tay ba bước.
- Giải thích cách TCP đảm bảo dữ liệu đến đủ và đúng thứ tự.

## Đặc điểm
TCP là giao thức **hướng kết nối** và **tin cậy**: dữ liệu đến đủ, không trùng, đúng thứ tự. Web, email, truyền tệp đều dùng TCP.

## Bắt tay ba bước
Trước khi gửi dữ liệu, hai bên thiết lập kết nối:
1. Máy khách gửi **SYN**.
2. Máy chủ trả lời **SYN-ACK**.
3. Máy khách gửi **ACK**.

Sau bước này cả hai đã thống nhất số thứ tự ban đầu và sẵn sàng truyền.

## Cơ chế tin cậy
- **Số thứ tự**: mỗi byte được đánh số, bên nhận sắp lại đúng thứ tự.
- **ACK**: bên nhận xác nhận đã nhận đến byte nào.
- **Gửi lại**: quá thời gian mà chưa có ACK thì gửi lại.
- **Điều khiển luồng**: bên nhận báo còn bao nhiêu chỗ trống trong bộ đệm để bên gửi không gửi quá nhanh.
- **Điều khiển tắc nghẽn**: khi phát hiện mất gói, TCP giảm tốc độ gửi để mạng hồi phục.

## Cái giá của sự tin cậy
Một gói bị mất làm **mọi dữ liệu phía sau phải chờ** cho đến khi gói đó được gửi lại. Với tải tệp thì không sao, nhưng với thoại thì 200 mili giây chờ đợi nghĩa là người nghe thấy khựng tiếng.

## Cổng thông dụng
- 80: HTTP, 443: HTTPS
- 22: SSH
- 5432: PostgreSQL`,
          ],
          [
            "Bài 4: UDP và ứng dụng thời gian thực",
            `# UDP và ứng dụng thời gian thực

## Mục tiêu
- So sánh UDP với TCP.
- Giải thích vì sao thoại và video chọn UDP.

## Đặc điểm của UDP
UDP **không kết nối** và **không đảm bảo**: không bắt tay, không ACK, không gửi lại, không sắp thứ tự. Phần đầu chỉ 8 byte, so với ít nhất 20 byte của TCP.

## Vì sao thoại dùng UDP?
Với cuộc gọi, **đúng lúc quan trọng hơn đầy đủ**. Một gói âm thanh 20 mili giây đến trễ nửa giây thì vô dụng, vì thời điểm phát nó đã qua. Thà bỏ gói đó và phát tiếp còn hơn dừng cả cuộc gọi để chờ gửi lại.

Tai người chấp nhận được mất vài phần trăm gói tin, nhất là khi bộ giải mã có cơ chế che lấp mất gói.

## So sánh nhanh
- **Kết nối**: TCP có bắt tay, UDP không.
- **Tin cậy**: TCP gửi lại khi mất, UDP không.
- **Thứ tự**: TCP đảm bảo, UDP không.
- **Độ trễ**: TCP có thể tăng vọt khi mất gói, UDP ổn định.
- **Dùng cho**: TCP cho web, email, tệp; UDP cho thoại, video trực tiếp, DNS, game.

## Ứng dụng tự lo phần còn thiếu
Vì UDP không đánh số, giao thức phía trên như **RTP** tự thêm số thứ tự và dấu thời gian để bên nhận phát hiện mất gói và phát đúng nhịp.

> Lưu ý vận hành: nhiều tường lửa chặn UDP. Hệ thống họp trực tuyến thường phải có phương án dự phòng qua TCP hoặc TLS cổng 443.`,
          ],
        ],
        quiz: [
          one(
            "Thứ tự đúng của bắt tay ba bước TCP là gì?",
            ["SYN, ACK, SYN-ACK", "SYN, SYN-ACK, ACK", "ACK, SYN, SYN-ACK", "SYN-ACK, SYN, ACK"],
            1,
            "Máy khách gửi SYN, máy chủ trả SYN-ACK, máy khách xác nhận bằng ACK.",
          ),
          one(
            "Vì sao thoại thời gian thực thường dùng UDP thay vì TCP?",
            [
              "UDP mã hóa tốt hơn",
              "UDP đảm bảo không mất gói",
              "Gói đến trễ là vô dụng, nên không cần chờ gửi lại",
              "UDP dùng ít địa chỉ IP hơn",
            ],
            2,
            "Việc TCP chờ gửi lại gói mất làm tăng độ trễ, gây khựng tiếng.",
          ),
          tf(
            "UDP tự đánh số thứ tự và sắp xếp lại các gói tin ở bên nhận.",
            false,
            "UDP không có số thứ tự; giao thức phía trên như RTP đảm nhận việc này.",
          ),
        ],
      },
      {
        title: "Chương 3: Thoại qua Internet",
        lessons: [
          [
            "Bài 5: SIP và RTP - thiết lập và truyền cuộc gọi",
            `# SIP và RTP

## Mục tiêu
- Phân biệt báo hiệu (SIP) và truyền âm thanh (RTP).
- Đọc được luồng bản tin của một cuộc gọi cơ bản.

## Hai việc tách biệt
- **Báo hiệu**: tìm người được gọi, đổ chuông, thỏa thuận cách truyền, kết thúc cuộc gọi. Do **SIP** đảm nhận.
- **Truyền âm thanh**: mang các gói tiếng nói. Do **RTP** đảm nhận, chạy trên UDP.

## Luồng cuộc gọi cơ bản
${F}text
Người gọi                Tổng đài               Người nghe
   | ---- INVITE ---------> | ---- INVITE --------> |
   | <--- 100 Trying ------ |                       |
   | <--- 180 Ringing ----- | <--- 180 Ringing ---- |
   | <--- 200 OK ---------- | <--- 200 OK --------- |
   | ---- ACK ------------> | ---- ACK -----------> |
   | <========== RTP: âm thanh hai chiều =========> |
   | ---- BYE ------------> | ---- BYE -----------> |
   | <--- 200 OK ---------- | <--- 200 OK --------- |
${F}

## Bản tin SIP
SIP là giao thức dạng văn bản, giống HTTP. Mã trả lời cũng tương tự:
- **1xx**: đang xử lý (100 Trying, 180 Ringing).
- **2xx**: thành công (200 OK).
- **4xx**: lỗi phía gọi (404 Not Found, 486 Busy Here).
- **5xx**: lỗi máy chủ.

## SDP
Trong INVITE và 200 OK có phần **SDP** mô tả phiên truyền: địa chỉ IP, cổng nhận RTP và danh sách **codec** hỗ trợ. Hai bên chọn codec chung, ví dụ G.711 (64 kbit/s, chất lượng cao) hoặc Opus (thích ứng theo băng thông).

## Tổng đài và SIP trunk
**Tổng đài IP (PBX)** như Asterisk đăng ký các máy nhánh, định tuyến cuộc gọi, xếp hàng chờ. **SIP trunk** là đường kết nối tổng đài với nhà mạng để gọi ra và nhận cuộc gọi từ số điện thoại thật.`,
          ],
          [
            "Bài 6: Đo chất lượng thoại - độ trễ, jitter, mất gói, MOS",
            `# Đo chất lượng thoại

## Mục tiêu
- Định nghĩa bốn chỉ số: độ trễ, jitter, mất gói, MOS.
- Biết ngưỡng chấp nhận được và hướng khắc phục.

## Độ trễ (delay)
Thời gian từ lúc nói đến lúc đầu kia nghe thấy. Khuyến nghị ITU-T G.114: dưới **150 mili giây** một chiều là tốt; trên 400 mili giây hai người bắt đầu nói chồng lên nhau.

## Jitter
Là **độ dao động của độ trễ** giữa các gói. Gói được gửi đều 20 mili giây một lần nhưng đến lúc nhanh lúc chậm. Bên nhận dùng **bộ đệm jitter** giữ gói lại một chút để phát cho đều; bộ đệm càng lớn thì càng mượt nhưng độ trễ càng tăng. Nên giữ jitter dưới 30 mili giây.

## Mất gói (packet loss)
Tỉ lệ gói không đến nơi. Dưới 1% hầu như không nhận ra; trên 3% tiếng bắt đầu đứt quãng, tùy codec.

## MOS
**Mean Opinion Score** là điểm chất lượng cảm nhận từ 1 (rất tệ) đến 5 (xuất sắc). Từ 4.0 trở lên là tốt, dưới 3.6 nhiều người dùng không hài lòng.

Không thể hỏi ý kiến người nghe cho từng cuộc gọi, nên người ta dùng **E-model** (ITU-T G.107): tính hệ số R từ độ trễ, mất gói và codec, rồi quy đổi R ra MOS ước lượng.

## Lấy số liệu từ đâu?
Các bên trao đổi báo cáo **RTCP** định kỳ, trong đó có tỉ lệ mất gói, jitter và thời gian khứ hồi (RTT).

## Hướng khắc phục
1. Ưu tiên lưu lượng thoại trên router (QoS).
2. Dùng mạng dây thay cho Wi-Fi yếu.
3. Chọn codec chịu mất gói tốt như Opus.
4. Giảm chất lượng video để dành băng thông cho âm thanh.

> Trong một cuộc họp, người dùng tha thứ cho hình ảnh mờ nhưng không tha thứ cho âm thanh đứt quãng.`,
          ],
        ],
        quiz: [
          one(
            "Giao thức nào mang các gói âm thanh của cuộc gọi VoIP?",
            ["SIP", "RTP", "SDP", "DNS"],
            1,
            "SIP lo báo hiệu, SDP mô tả phiên, RTP mới mang âm thanh.",
          ),
          one(
            "Jitter là gì?",
            [
              "Tỉ lệ gói tin bị mất",
              "Độ dao động của độ trễ giữa các gói",
              "Tổng thời gian cuộc gọi",
              "Băng thông tối đa của đường truyền",
            ],
            1,
            "Jitter đo mức không đều của thời điểm gói đến nơi.",
          ),
          many(
            "Những yếu tố nào được E-model dùng để ước lượng chất lượng thoại?",
            ["Độ trễ", "Tỉ lệ mất gói", "Loại codec", "Tên người gọi"],
            [0, 1, 2],
            "E-model tính hệ số R từ độ trễ, mất gói và đặc tính codec rồi quy ra MOS.",
          ),
        ],
      },
    ],
  },
  {
    code: "RM-301",
    title: "Phương pháp nghiên cứu và viết báo cáo đồ án",
    description:
      "Đồng hành cùng sinh viên từ lúc chọn đề tài đến lúc nộp báo cáo. Sau khóa học bạn đặt được câu hỏi nghiên cứu rõ ràng, tìm và trích dẫn tài liệu đúng chuẩn, trình bày kết quả thực nghiệm thuyết phục và tránh được lỗi đạo văn. Thời lượng khoảng 5 giờ tự học.",
    chapters: [
      {
        title: "Chương 1: Xác định vấn đề nghiên cứu",
        lessons: [
          [
            "Bài 1: Chọn đề tài và đặt câu hỏi nghiên cứu",
            `# Chọn đề tài và đặt câu hỏi nghiên cứu

## Mục tiêu
- Thu hẹp một chủ đề rộng thành đề tài làm được trong một học kỳ.
- Viết câu hỏi nghiên cứu và mục tiêu đo lường được.

## Từ chủ đề đến đề tài
"Ứng dụng trí tuệ nhân tạo trong giáo dục" là **chủ đề**, quá rộng. "Tóm tắt tự động biên bản cuộc họp tiếng Việt bằng mô hình ngôn ngữ lớn" là **đề tài**: có đối tượng, phương pháp và phạm vi rõ.

Ba câu hỏi để thu hẹp:
1. Vấn đề cụ thể của **ai**, trong **bối cảnh** nào?
2. Giải pháp hiện có **thiếu** gì?
3. Trong thời gian và nguồn lực của mình, làm được **đến đâu**?

## Câu hỏi nghiên cứu
Câu hỏi tốt phải trả lời được bằng bằng chứng, không phải bằng ý kiến.
- Yếu: "Hệ thống họp trực tuyến có tốt không?"
- Tốt: "Điều chỉnh chất lượng video theo băng thông giúp giảm tỉ lệ đứt hình bao nhiêu phần trăm khi mạng mất gói 5%?"

## Mục tiêu theo SMART
- **Specific**: cụ thể.
- **Measurable**: đo được.
- **Achievable**: khả thi.
- **Relevant**: liên quan đến câu hỏi.
- **Time-bound**: có thời hạn.

Ví dụ: "Xây dựng tổng đài nhận cuộc gọi từ số thật, chịu được 20 cuộc đồng thời với MOS trung bình từ 4.0, hoàn thành trước tuần 12."

## Xác định phạm vi
Viết rõ đề tài **không** làm gì. Phần "giới hạn đề tài" giúp hội đồng đánh giá đúng và giúp chính bạn không sa đà.`,
          ],
          [
            "Bài 2: Tìm và đánh giá tài liệu tham khảo",
            `# Tìm và đánh giá tài liệu tham khảo

## Mục tiêu
- Tìm tài liệu học thuật bằng từ khóa hiệu quả.
- Đánh giá độ tin cậy của nguồn.

## Tìm ở đâu?
- **Google Scholar**, **IEEE Xplore**, **ACM Digital Library**: bài báo khoa học.
- Thư viện số của trường: sách và cơ sở dữ liệu có bản quyền.
- **Tài liệu chuẩn**: RFC của IETF, khuyến nghị ITU-T, tài liệu chính thức của công nghệ đang dùng.

## Kỹ thuật tìm kiếm
- Dùng từ khóa tiếng Anh, đặt cụm từ trong dấu nháy kép: "adaptive bitrate".
- Kết hợp bằng AND, OR; giới hạn năm xuất bản.
- **Lần theo trích dẫn**: đọc danh mục tham khảo của một bài hay, và xem những bài mới hơn đã trích dẫn nó.

## Đánh giá nguồn
1. **Tác giả và nơi công bố**: tạp chí, hội nghị có phản biện hay blog cá nhân?
2. **Thời điểm**: với công nghệ, tài liệu 10 năm tuổi có thể đã lỗi thời.
3. **Bằng chứng**: có số liệu, phương pháp rõ ràng hay chỉ là nhận định?
4. **Số lần được trích dẫn**: tham khảo, không phải thước đo tuyệt đối.

Wikipedia và blog dùng để **định hướng ban đầu**, không nên là nguồn trích dẫn chính.

## Đọc có chiến lược
Đọc theo ba lượt: (1) tiêu đề, tóm tắt, kết luận để quyết định có đọc tiếp không; (2) hình, bảng và phần phương pháp; (3) đọc kỹ toàn bộ với những bài quan trọng nhất.

## Ghi chép
Với mỗi tài liệu, ghi ngay: thông tin trích dẫn đầy đủ, ý chính bằng lời của mình, và nó liên quan gì tới đề tài. Dùng Zotero hoặc Mendeley để quản lý.`,
          ],
        ],
        quiz: [
          one(
            "Phát biểu nào là một câu hỏi nghiên cứu tốt?",
            [
              "Trí tuệ nhân tạo có quan trọng không?",
              "Hệ thống của em có tốt không?",
              "Bộ đệm jitter thích ứng giảm được bao nhiêu phần trăm gói đến trễ so với bộ đệm cố định 60 ms?",
              "Nên dùng công nghệ gì?",
            ],
            2,
            "Câu hỏi tốt cụ thể, có đối tượng so sánh và trả lời được bằng số liệu.",
          ),
          tf(
            "Phần giới hạn đề tài làm báo cáo yếu đi nên cần tránh viết.",
            false,
            "Nêu rõ phạm vi giúp hội đồng đánh giá đúng và thể hiện người viết hiểu đề tài.",
          ),
          one(
            "Nguồn nào phù hợp nhất để trích dẫn khi mô tả giao thức SIP?",
            [
              "Một bài đăng trên mạng xã hội",
              "RFC 3261 của IETF",
              "Câu trả lời của chatbot",
              "Một video hướng dẫn",
            ],
            1,
            "Tài liệu chuẩn gốc là nguồn đáng tin cậy nhất cho đặc tả giao thức.",
          ),
        ],
      },
      {
        title: "Chương 2: Thực nghiệm và đánh giá",
        lessons: [
          [
            "Bài 3: Thiết kế thực nghiệm",
            `# Thiết kế thực nghiệm

## Mục tiêu
- Xác định biến độc lập, biến phụ thuộc và biến kiểm soát.
- Thiết kế thí nghiệm lặp lại được.

## Thực nghiệm để làm gì?
Để trả lời câu hỏi nghiên cứu bằng số liệu. "Hệ thống chạy được" chưa phải kết quả; "hệ thống giữ MOS trên 4.0 với 20 cuộc gọi đồng thời" mới là kết quả.

## Ba loại biến
- **Biến độc lập**: thứ bạn chủ động thay đổi, ví dụ số cuộc gọi đồng thời (5, 10, 20, 40).
- **Biến phụ thuộc**: thứ bạn đo, ví dụ MOS, tỉ lệ cuộc gọi thành công, mức dùng CPU.
- **Biến kiểm soát**: thứ phải giữ nguyên, ví dụ cấu hình máy, codec, thời lượng mỗi cuộc gọi.

Mỗi lần chỉ thay đổi **một** biến độc lập. Đổi hai thứ cùng lúc thì không biết kết quả do đâu.

## Đường cơ sở (baseline)
Kết quả chỉ có nghĩa khi so với một mốc: phiên bản chưa tối ưu, một hệ thống mã nguồn mở, hoặc ngưỡng trong tiêu chuẩn.

## Lặp lại và ghi chép
- Chạy mỗi cấu hình **ít nhất 3 đến 5 lần**, báo cáo trung bình và độ lệch.
- Ghi lại môi trường: phần cứng, phiên bản phần mềm, tham số.
- Tự động hóa bằng kịch bản để người khác chạy lại được.

## Cạm bẫy thường gặp
1. Thay đổi mã nguồn giữa chừng một lượt đo.
2. Chỉ báo cáo lần chạy đẹp nhất.
3. Đo trên máy đang chạy nhiều chương trình khác.
4. Mẫu quá nhỏ rồi kết luận quá rộng.

> Kết quả xấu vẫn là kết quả. Báo cáo trung thực giới hạn của hệ thống được đánh giá cao hơn số liệu đẹp nhưng không giải thích được.`,
          ],
          [
            "Bài 4: Trình bày số liệu bằng bảng và biểu đồ",
            `# Trình bày số liệu bằng bảng và biểu đồ

## Mục tiêu
- Chọn đúng loại biểu đồ cho từng loại dữ liệu.
- Viết chú thích và diễn giải kết quả.

## Bảng hay biểu đồ?
- **Bảng** khi người đọc cần tra giá trị chính xác.
- **Biểu đồ** khi muốn cho thấy xu hướng hoặc so sánh.

## Chọn loại biểu đồ
- **Đường**: thay đổi theo một đại lượng liên tục, ví dụ MOS theo số cuộc gọi đồng thời.
- **Cột**: so sánh giữa các nhóm rời rạc, ví dụ độ trễ của ba codec.
- **Hộp (box plot)**: phân bố và giá trị ngoại lai.
- **Tròn**: hạn chế dùng; mắt người so sánh góc kém hơn so sánh độ dài.

## Nguyên tắc trình bày
1. Trục có **tên và đơn vị**: "Độ trễ (ms)", không chỉ "Độ trễ".
2. Trục tung của biểu đồ cột bắt đầu từ 0 để không phóng đại khác biệt.
3. Mỗi hình một thông điệp; tối đa 4 đến 5 đường trên một biểu đồ.
4. Chú thích đủ để hiểu hình mà không cần đọc phần thân: "Hình 4.2: MOS trung bình theo số cuộc gọi đồng thời (5 lần chạy, thanh sai số là độ lệch chuẩn)".
5. Màu phân biệt được khi in đen trắng.

## Diễn giải, đừng chỉ mô tả
- Mô tả: "MOS giảm từ 4.3 xuống 3.1 khi tăng từ 20 lên 40 cuộc gọi."
- Diễn giải: "MOS giảm mạnh sau 20 cuộc gọi vì CPU chạm 95%, làm trễ việc chuyển tiếp gói RTP. Đây là giới hạn của cấu hình thử nghiệm 2 nhân."

Mọi hình và bảng đều phải được **nhắc đến trong phần thân** và được phân tích.`,
          ],
        ],
        quiz: [
          one(
            "Trong thí nghiệm đo MOS theo số cuộc gọi đồng thời, MOS là loại biến nào?",
            ["Biến độc lập", "Biến phụ thuộc", "Biến kiểm soát", "Hằng số"],
            1,
            "MOS là đại lượng được đo, phụ thuộc vào số cuộc gọi mà ta chủ động thay đổi.",
          ),
          tf(
            "Nên thay đổi nhiều biến độc lập cùng lúc để tiết kiệm thời gian đo.",
            false,
            "Thay đổi nhiều biến cùng lúc thì không xác định được nguyên nhân của kết quả.",
          ),
          one(
            "Loại biểu đồ nào phù hợp nhất để thể hiện MOS thay đổi theo số cuộc gọi đồng thời tăng dần?",
            ["Biểu đồ tròn", "Biểu đồ đường", "Bảng chữ", "Sơ đồ khối"],
            1,
            "Biểu đồ đường thể hiện tốt xu hướng theo một đại lượng tăng dần.",
          ),
        ],
      },
      {
        title: "Chương 3: Viết và bảo vệ báo cáo",
        lessons: [
          [
            "Bài 5: Cấu trúc báo cáo và văn phong học thuật",
            `# Cấu trúc báo cáo và văn phong học thuật

## Mục tiêu
- Sắp xếp nội dung theo cấu trúc chuẩn của báo cáo đồ án.
- Viết đoạn văn rõ ràng, khách quan.

## Cấu trúc thông dụng
1. **Mở đầu**: bối cảnh, vấn đề, mục tiêu, phạm vi, đóng góp.
2. **Cơ sở lý thuyết và công trình liên quan**: kiến thức nền và những gì người khác đã làm.
3. **Phân tích và thiết kế**: yêu cầu, kiến trúc, lựa chọn công nghệ kèm lý do.
4. **Hiện thực**: những phần cốt lõi, khó, hoặc khác biệt. Không dán toàn bộ mã nguồn.
5. **Thực nghiệm và đánh giá**: phương pháp đo, kết quả, phân tích.
6. **Kết luận và hướng phát triển**: đã đạt gì so với mục tiêu, còn hạn chế gì.

## Tóm tắt (abstract)
Khoảng 200 từ, viết **sau cùng**, gồm bốn ý: vấn đề, cách tiếp cận, kết quả chính (có số liệu), ý nghĩa.

## Văn phong
- **Khách quan**: "Kết quả cho thấy" thay vì "Em thấy rất tốt".
- **Chính xác**: "giảm 23% độ trễ" thay vì "nhanh hơn nhiều".
- **Nhất quán thuật ngữ**: đã gọi là "tổng đài viên" thì không đổi thành "nhân viên trực", "agent".
- **Câu ngắn**: mỗi câu một ý; mỗi đoạn mở bằng câu chủ đề.
- Thuật ngữ tiếng Anh: lần đầu ghi kèm trong ngoặc, ví dụ "bộ đệm jitter (jitter buffer)".

## Giải thích lựa chọn
Hội đồng không chỉ hỏi "làm gì" mà còn hỏi "**vì sao** làm vậy". Với mỗi quyết định thiết kế, nêu phương án đã cân nhắc và lý do chọn.

## Rà soát trước khi nộp
- Đánh số hình, bảng, công thức và tham chiếu chéo đúng.
- Danh mục từ viết tắt đầy đủ.
- Nhờ một người ngoài nhóm đọc thử phần mở đầu.`,
          ],
          [
            "Bài 6: Trích dẫn, đạo văn và chuẩn bị buổi bảo vệ",
            `# Trích dẫn, đạo văn và chuẩn bị buổi bảo vệ

## Mục tiêu
- Trích dẫn đúng chuẩn IEEE.
- Nhận biết và tránh các dạng đạo văn.
- Chuẩn bị bài trình bày 15 phút.

## Khi nào phải trích dẫn?
Mọi ý tưởng, số liệu, hình ảnh, đoạn mã **không phải của bạn** và **không phải kiến thức phổ thông** đều phải ghi nguồn.

## Chuẩn IEEE
Đánh số theo thứ tự xuất hiện, đặt trong ngoặc vuông:

${F}text
Mô hình E-model ước lượng chất lượng thoại từ các tham số mạng [3].

[3] ITU-T, "The E-model: a computational model for use in
    transmission planning," Recommendation G.107, 2015.
${F}

## Các dạng đạo văn
- Chép nguyên văn không đặt trong ngoặc kép và không ghi nguồn.
- **Diễn đạt lại** ý của người khác mà không ghi nguồn. Đổi từ ngữ không làm ý tưởng thành của mình.
- Dùng hình, bảng của người khác không ghi nguồn.
- Nộp lại bài cũ của chính mình cho môn khác mà không nói rõ.
- Dùng công cụ AI viết hộ rồi trình bày như tự viết, trái quy định của môn học.

Cách phòng tránh: ghi chép bằng lời của mình ngay từ lúc đọc, kèm nguồn; kiểm tra bằng công cụ phát hiện trùng lặp trước khi nộp.

## Bài trình bày
- Khoảng **một slide mỗi phút**. Slide ít chữ, nhiều hình.
- Bố cục: vấn đề, mục tiêu, giải pháp, **demo**, kết quả, hạn chế.
- Dành thời gian nhiều nhất cho phần đóng góp của chính mình.
- Chuẩn bị video demo dự phòng khi mạng hoặc thiết bị trục trặc.

## Trả lời câu hỏi
1. Nghe hết câu hỏi, nhắc lại ngắn gọn nếu cần.
2. Trả lời thẳng vào ý, rồi mới giải thích.
3. Không biết thì nói thật và nêu hướng mình sẽ tìm hiểu.

> Hội đồng đánh giá cao người hiểu rõ giới hạn của công trình mình hơn là người khẳng định hệ thống hoàn hảo.`,
          ],
        ],
        quiz: [
          tf(
            "Diễn đạt lại ý tưởng của người khác bằng lời của mình thì không cần ghi nguồn.",
            false,
            "Ý tưởng vẫn là của tác giả gốc; không ghi nguồn là đạo văn.",
          ),
          one(
            "Phần tóm tắt (abstract) nên được viết vào lúc nào?",
            [
              "Đầu tiên, trước khi làm đề tài",
              "Sau cùng, khi đã có kết quả",
              "Không cần viết",
              "Giữa chừng, trước phần thực nghiệm",
            ],
            1,
            "Tóm tắt phải nêu được kết quả chính nên viết sau khi hoàn thành các chương.",
          ),
          many(
            "Những việc nào nên làm khi chuẩn bị buổi bảo vệ?",
            [
              "Chuẩn bị video demo dự phòng",
              "Đưa toàn bộ nội dung báo cáo lên slide",
              "Dành nhiều thời gian nhất cho đóng góp của mình",
              "Nêu rõ hạn chế của đề tài",
            ],
            [0, 2, 3],
            "Slide nên ít chữ; đưa toàn bộ báo cáo lên slide làm người nghe không theo kịp.",
          ),
        ],
      },
    ],
  },
  {
    code: "SK-101",
    title: "Kỹ năng giao tiếp và làm việc nhóm",
    description:
      "Những kỹ năng mềm dùng hằng ngày ở trường và nơi làm việc: viết email được trả lời nhanh, điều hành cuộc họp ra quyết định, cho và nhận phản hồi, quản lý thời gian. Bài học ngắn, có mẫu áp dụng ngay. Thời lượng khoảng 4 giờ tự học.",
    chapters: [
      {
        title: "Chương 1: Giao tiếp bằng văn bản",
        lessons: [
          [
            "Bài 1: Viết email công việc rõ ràng",
            `# Viết email công việc rõ ràng

## Mục tiêu
- Viết tiêu đề và phần mở đầu để người nhận hiểu ngay cần làm gì.
- Áp dụng cấu trúc ba phần cho email công việc.

## Người nhận rất bận
Một giảng viên hay quản lý nhận hàng chục email mỗi ngày. Email được trả lời nhanh là email **đọc trong 30 giây là hiểu** mình cần làm gì.

## Tiêu đề
Tiêu đề phải nói được nội dung và hành động mong muốn.
- Yếu: "Hỏi thầy", "Gấp!!!"
- Tốt: "[Đồ án TN - Nhóm 7] Xin lịch gặp góp ý chương 3 trước ngày 20/11"

## Cấu trúc ba phần
1. **Mở đầu bằng điều cần nhất**: đề nghị hoặc thông tin chính, ngay câu đầu tiên.
2. **Bối cảnh vừa đủ**: những gì người nhận cần biết để quyết định.
3. **Bước tiếp theo**: ai làm gì, trước khi nào.

## Ví dụ
${F}text
Kính gửi thầy Khoa,

Nhóm em xin phép được gặp thầy 30 phút trong tuần này để xin góp ý
chương 3 (thiết kế hệ thống) trước khi viết tiếp chương 4.

Nhóm đã hoàn thành sơ đồ kiến trúc và mô hình dữ liệu, bản nháp đính kèm.
Nhóm còn phân vân giữa hai phương án lưu bản ghi cuộc họp ở trang 12.

Nhóm rảnh chiều thứ Tư và sáng thứ Sáu. Thầy chọn giúp nhóm khung giờ
thuận tiện ạ.

Em cảm ơn thầy.
Nguyễn Văn An - 52100123 - Nhóm 7
${F}

## Lưu ý
- Một email một chủ đề.
- Đính kèm thì nói rõ trong thư đính kèm gì.
- Đọc lại một lượt trước khi gửi; kiểm tra tên người nhận và tệp đính kèm.
- Trả lời trong vòng một ngày làm việc, dù chỉ để báo "em đã nhận, sẽ phản hồi trước thứ Sáu".`,
          ],
          [
            "Bài 2: Nhắn tin nhóm và viết tài liệu ngắn",
            `# Nhắn tin nhóm và viết tài liệu ngắn

## Mục tiêu
- Dùng kênh chat nhóm mà không làm phiền người khác.
- Viết ghi chú, hướng dẫn ngắn để người khác tự làm theo được.

## Chat nhóm
- **Viết trọn ý trong một tin**. Đừng gửi "Alo" rồi chờ; hãy viết luôn câu hỏi để người kia trả lời khi rảnh.
- **Trả lời theo luồng (thread)** để kênh chung không bị trôi.
- **Chỉ nhắc tên người cần đọc**. Nhắc cả nhóm chỉ khi thật sự mọi người đều phải biết.
- Việc quan trọng hoặc cần lưu lâu dài: chốt lại bằng email hoặc ghi vào tài liệu, đừng để chìm trong chat.

## Hỏi sao cho dễ được giúp
Một câu hỏi tốt gồm: đang cố làm gì, đã thử gì, kết quả ra sao (kèm thông báo lỗi nguyên văn), và mong đợi điều gì.

- Yếu: "Code em không chạy, ai giúp với."
- Tốt: "Em chạy lệnh migrate thì báo lỗi relation 'users' does not exist. Em đã thử xóa và tạo lại cơ sở dữ liệu nhưng vẫn vậy. Có phải em chạy thiếu bước nào không ạ?"

## Viết tài liệu ngắn
Hướng dẫn cài đặt, biên bản, ghi chú bàn giao đều theo nguyên tắc:
1. **Kết luận trước**, chi tiết sau.
2. Dùng tiêu đề và danh sách để người đọc lướt được.
3. Các bước thao tác đánh số, mỗi bước một hành động.
4. Ghi ngày cập nhật và người phụ trách.

## Phép thử
Đưa tài liệu cho một người chưa biết gì về việc đó. Nếu họ làm theo được mà không cần hỏi lại, tài liệu đã đạt.`,
          ],
        ],
        quiz: [
          one(
            "Tiêu đề email nào tốt nhất?",
            [
              "Gấp!!!",
              "Hỏi thầy",
              "[Đồ án TN - Nhóm 7] Xin lịch gặp góp ý chương 3 trước 20/11",
              "Không có tiêu đề",
            ],
            2,
            "Tiêu đề tốt nêu rõ bối cảnh, nội dung và thời hạn.",
          ),
          tf(
            "Trong email công việc, nên trình bày bối cảnh thật chi tiết rồi mới nêu đề nghị ở cuối thư.",
            false,
            "Điều cần nhất nên nằm ở câu đầu tiên; bối cảnh chỉ cần vừa đủ.",
          ),
          one(
            "Cách nhắn tin nào giúp đồng đội hỗ trợ bạn nhanh nhất?",
            [
              "Gửi 'Alo' và chờ trả lời",
              "Nhắc tên cả nhóm với nội dung 'giúp em với'",
              "Nêu việc đang làm, đã thử gì, lỗi nguyên văn và điều mong đợi",
              "Gọi điện liên tục",
            ],
            2,
            "Câu hỏi đủ thông tin giúp người khác trả lời ngay mà không phải hỏi lại.",
          ),
        ],
      },
      {
        title: "Chương 2: Làm việc nhóm",
        lessons: [
          [
            "Bài 3: Điều hành cuộc họp hiệu quả",
            `# Điều hành cuộc họp hiệu quả

## Mục tiêu
- Chuẩn bị chương trình họp và ghi biên bản có việc cần làm.
- Giữ cuộc họp đúng giờ, đúng trọng tâm.

## Có cần họp không?
Họp tốn thời gian của mọi người cùng lúc. Chỉ họp khi cần **thảo luận để ra quyết định** hoặc giải quyết vướng mắc. Thông báo một chiều thì gửi tin nhắn.

## Trước cuộc họp
- Gửi **chương trình** trước ít nhất một ngày: mục tiêu, các mục cần bàn, thời lượng từng mục, tài liệu cần đọc trước.
- Chỉ mời người thật sự cần có mặt.
- Phân vai: người điều hành, người ghi biên bản, người canh giờ.

## Trong cuộc họp
1. Bắt đầu đúng giờ, nhắc lại mục tiêu.
2. Đi theo chương trình. Vấn đề phát sinh ngoài lề thì ghi vào danh sách "bàn sau".
3. Mời người ít nói phát biểu; không để một người nói suốt.
4. Mỗi mục kết thúc bằng **một quyết định** hoặc **một việc cần làm**.
5. Dành 5 phút cuối để đọc lại các quyết định và phân công.

## Biên bản
Biên bản không cần chép lại ai nói gì. Chỉ cần:
- Các **quyết định** đã chốt.
- Danh sách việc: **việc gì, ai làm, hạn khi nào**.
- Những vấn đề còn mở.

Gửi biên bản trong vòng 24 giờ, khi mọi người còn nhớ.

## Họp trực tuyến
- Bật camera nếu được, tắt micro khi không nói.
- Dùng tính năng giơ tay thay vì ngắt lời.
- Chia sẻ màn hình tài liệu đang bàn để mọi người cùng nhìn một chỗ.

> Một cuộc họp không có biên bản và không có việc cần làm thì gần như chưa từng diễn ra.`,
          ],
          [
            "Bài 4: Cho và nhận phản hồi",
            `# Cho và nhận phản hồi

## Mục tiêu
- Đưa phản hồi cụ thể theo mô hình SBI.
- Tiếp nhận phản hồi mà không phòng thủ.

## Vì sao phản hồi khó?
Người nói sợ làm mất lòng, người nghe dễ thấy bị tấn công. Kết quả là vấn đề nhỏ không ai nói, tích tụ thành mâu thuẫn lớn vào tuần cuối của đồ án.

## Mô hình SBI
- **Situation (tình huống)**: khi nào, ở đâu.
- **Behavior (hành vi)**: việc cụ thể quan sát được, không phải nhận xét về tính cách.
- **Impact (tác động)**: hệ quả đối với nhóm hoặc công việc.

Ví dụ:
- Yếu: "Bạn lúc nào cũng vô trách nhiệm."
- Tốt: "Tuần này (tình huống) phần giao diện đăng nhập được đẩy lên trễ hai ngày và không báo trước (hành vi), nên mình không kịp ghép và kiểm thử trước buổi báo cáo (tác động). Lần sau nếu thấy sẽ trễ, bạn báo sớm để nhóm sắp xếp lại được không?"

## Nguyên tắc khi cho phản hồi
1. **Sớm**: nói trong vài ngày, đừng để dồn.
2. **Riêng tư** với phản hồi cần cải thiện; **công khai** với lời khen.
3. **Cụ thể** và hướng đến việc sau này làm khác đi thế nào.
4. Khen cũng phải cụ thể: "Phần tài liệu API bạn viết giúp mình ghép nối trong một buổi" có giá trị hơn "Làm tốt lắm".

## Khi nhận phản hồi
- **Nghe hết**, đừng ngắt lời để giải thích.
- **Hỏi lại** để hiểu rõ: "Bạn cho mình một ví dụ được không?"
- **Cảm ơn**, kể cả khi chưa đồng ý.
- Suy nghĩ rồi mới quyết định sẽ thay đổi gì. Không bắt buộc đồng ý với mọi phản hồi, nhưng bắt buộc phải cân nhắc.

## Khi có mâu thuẫn
Tách **con người** khỏi **vấn đề**. Cùng nhìn vào mục tiêu chung của nhóm, liệt kê các phương án, chọn theo tiêu chí đã thống nhất. Nếu bế tắc, nhờ giảng viên hướng dẫn hoặc trưởng nhóm làm trung gian sớm.`,
          ],
        ],
        quiz: [
          many(
            "Một biên bản họp tốt cần có những gì?",
            [
              "Các quyết định đã chốt",
              "Lời thoại nguyên văn của từng người",
              "Danh sách việc kèm người phụ trách và thời hạn",
              "Những vấn đề còn mở",
            ],
            [0, 2, 3],
            "Biên bản tập trung vào quyết định và việc cần làm, không cần chép lại toàn bộ lời nói.",
          ),
          one(
            "Trong mô hình SBI, chữ B là gì?",
            [
              "Bối cảnh chung của dự án",
              "Hành vi cụ thể quan sát được",
              "Niềm tin của người nói",
              "Lợi ích của nhóm",
            ],
            1,
            "Behavior: mô tả hành vi cụ thể, không đánh giá tính cách.",
          ),
          tf(
            "Phản hồi cần cải thiện nên được nói trước cả nhóm để mọi người cùng rút kinh nghiệm.",
            false,
            "Phản hồi cần cải thiện nên nói riêng; lời khen mới nên nói công khai.",
          ),
        ],
      },
      {
        title: "Chương 3: Quản lý công việc cá nhân",
        lessons: [
          [
            "Bài 5: Sắp xếp ưu tiên và lập kế hoạch tuần",
            `# Sắp xếp ưu tiên và lập kế hoạch tuần

## Mục tiêu
- Phân loại công việc bằng ma trận Eisenhower.
- Lập kế hoạch tuần có chỗ cho việc phát sinh.

## Bận không có nghĩa là hiệu quả
Việc **khẩn cấp** đòi sự chú ý ngay; việc **quan trọng** đóng góp vào mục tiêu dài hạn. Hai thứ này thường không trùng nhau, và việc khẩn cấp luôn lấn át nếu ta không chủ động.

## Ma trận Eisenhower
- **Quan trọng và khẩn cấp**: làm ngay. Ví dụ: sửa lỗi trước buổi demo ngày mai.
- **Quan trọng, không khẩn cấp**: **lên lịch**. Ví dụ: viết báo cáo đồ án, ôn thi, học kỹ năng mới. Đây là nhóm quyết định kết quả dài hạn và hay bị trì hoãn nhất.
- **Khẩn cấp, không quan trọng**: làm nhanh, gom lại, hoặc nhờ người khác. Ví dụ: phần lớn tin nhắn và thông báo.
- **Không quan trọng, không khẩn cấp**: bỏ bớt.

## Lập kế hoạch tuần
1. Tối Chủ nhật, liệt kê mọi việc của tuần tới.
2. Chọn **ba việc quan trọng nhất** phải xong.
3. Đặt chúng vào lịch như một cuộc hẹn, vào khung giờ bạn tỉnh táo nhất.
4. Để trống khoảng **30% thời gian** cho việc phát sinh.
5. Cuối tuần xem lại: việc gì xong, việc gì trượt, vì sao.

## Chia nhỏ công việc
"Viết chương 3" quá lớn nên dễ trì hoãn. Chia thành: vẽ sơ đồ kiến trúc, viết mục 3.1, viết mục 3.2. Mỗi việc làm xong trong một đến hai giờ.

## Ước lượng thời gian
Người ta thường ước lượng thiếu. Hãy ghi lại thời gian thực tế của vài việc, so với dự tính, rồi nhân hệ số cho lần sau.`,
          ],
          [
            "Bài 6: Tập trung sâu và tránh trì hoãn",
            `# Tập trung sâu và tránh trì hoãn

## Mục tiêu
- Áp dụng kỹ thuật Pomodoro.
- Thiết kế môi trường làm việc ít xao nhãng.

## Cái giá của việc chuyển qua lại
Mỗi lần liếc điện thoại, não cần nhiều phút để quay lại mức tập trung cũ. Một buổi tối bị ngắt 10 lần có thể chỉ còn vài chục phút làm việc thật sự.

## Kỹ thuật Pomodoro
1. Chọn **một** việc.
2. Hẹn giờ **25 phút**, làm liên tục, không kiểm tra tin nhắn.
3. Nghỉ **5 phút**: đứng dậy, uống nước, nhìn ra xa.
4. Sau bốn lượt, nghỉ dài 15 đến 30 phút.

Việc nảy ra giữa chừng thì ghi vào giấy rồi làm tiếp, không xử lý ngay.

## Thiết kế môi trường
- Tắt thông báo, để điện thoại ngoài tầm với.
- Đóng các thẻ trình duyệt không liên quan.
- Báo cho bạn cùng phòng hoặc nhóm khung giờ bạn cần tập trung.
- Chuẩn bị sẵn tài liệu và công cụ trước khi bắt đầu.

## Vì sao ta trì hoãn?
Trì hoãn thường không do lười mà do việc đó gây **khó chịu**: mơ hồ, quá lớn, hoặc sợ làm không tốt. Cách gỡ:
- **Quy tắc 5 phút**: cam kết chỉ làm 5 phút. Bắt đầu rồi thì thường làm tiếp được.
- **Làm rõ bước đầu tiên**: không phải "làm đồ án" mà là "mở tệp báo cáo và viết ba gạch đầu dòng cho mục 2.1".
- **Chấp nhận bản nháp xấu**: viết ra trước, sửa sau.

## Giữ sức
Ngủ đủ, vận động và nghỉ ngơi là điều kiện để tập trung, không phải phần thưởng sau khi xong việc. Thức trắng trước hạn nộp cho ra sản phẩm kém hơn làm đều mỗi ngày.

> Bạn không cần thêm thời gian. Bạn cần những khoảng thời gian không bị ngắt quãng.`,
          ],
        ],
        quiz: [
          one(
            "Theo ma trận Eisenhower, việc 'quan trọng nhưng không khẩn cấp' nên được xử lý thế nào?",
            [
              "Bỏ qua",
              "Lên lịch để làm",
              "Giao hết cho người khác",
              "Làm sau khi xong mọi việc khẩn cấp",
            ],
            1,
            "Đây là nhóm quyết định kết quả dài hạn; phải chủ động đặt lịch nếu không sẽ bị việc khẩn cấp lấn át.",
          ),
          one(
            "Một lượt Pomodoro chuẩn dài bao lâu?",
            [
              "10 phút làm, 10 phút nghỉ",
              "25 phút làm, 5 phút nghỉ",
              "60 phút làm, 30 phút nghỉ",
              "90 phút làm liên tục",
            ],
            1,
            "25 phút tập trung rồi nghỉ 5 phút; sau bốn lượt thì nghỉ dài.",
          ),
          tf(
            "Trì hoãn chủ yếu do lười biếng nên cách khắc phục duy nhất là ép mình kỷ luật hơn.",
            false,
            "Trì hoãn thường do việc mơ hồ, quá lớn hoặc gây lo lắng; chia nhỏ và làm rõ bước đầu tiên hiệu quả hơn.",
          ),
        ],
      },
    ],
  },
];

const repo = new ElearningRepository();
const courses = new CourseService(repo);

async function main() {
  const admin = (
    await pool.query(
      `SELECT u.id FROM users u JOIN academic_role_grants r ON r.user_id = u.id
       WHERE r.role = 'system_admin' ORDER BY r.created_at LIMIT 1`,
    )
  ).rows[0];
  if (!admin) throw new Error("Không tìm thấy tài khoản system_admin nào.");
  const unit = (
    await pool.query(
      `SELECT id, name FROM academic_units ORDER BY (name ILIKE 'khoa công nghệ thông tin') DESC, created_at LIMIT 1`,
    )
  ).rows[0];
  if (!unit) throw new Error("Chưa có đơn vị học thuật nào (chạy npm run seed:academic trước).");

  for (const course of COURSES) {
    if ((await pool.query(`SELECT 1 FROM courses WHERE code = $1`, [course.code])).rowCount) {
      console.log(`${course.code} đã có; giữ nguyên.`);
      continue;
    }
    const { id } = await courses.create(admin.id, {
      unitId: unit.id,
      code: course.code,
      title: course.title,
      description: course.description,
      enrollment: "open",
    });
    for (const chapter of course.chapters)
      await courses.addChapter(admin.id, id, { title: chapter.title });
    await courses.addChapter(admin.id, id, { title: "Tổng kết khóa học" });
    const chapterIds = (await courses.detail(admin.id, id)).chapters.map((chapter) => chapter.id);

    const quiz = async (chapterId, title, questionIds, settings) => {
      const lesson = await courses.addLesson(admin.id, chapterId, { kind: "quiz", title });
      await courses.updateLesson(admin.id, lesson.id, {
        questionIds,
        shuffle: true,
        ...settings,
        status: "published",
      });
    };
    const bank = [];
    for (const [index, chapter] of course.chapters.entries()) {
      for (const [title, body] of chapter.lessons) {
        const lesson = await courses.addLesson(admin.id, chapterIds[index], {
          kind: "document",
          title,
        });
        await courses.updateLesson(admin.id, lesson.id, { body, status: "published" });
      }
      const questionIds = [];
      for (const question of chapter.quiz)
        questionIds.push((await courses.saveQuestion(admin.id, id, null, question)).id);
      bank.push(...questionIds);
      await quiz(chapterIds[index], `Kiểm tra chương ${index + 1}`, questionIds, {
        passPercent: 60,
        timeLimitSeconds: 300,
      });
    }
    // Final exam: 6 of the 9 bank questions per attempt, so a retake is not the same paper.
    await quiz(chapterIds.at(-1), "Bài thi cuối khóa", bank, {
      drawCount: 6,
      passPercent: 70,
      timeLimitSeconds: 900,
      maxAttempts: 3,
    });
    await courses.update(admin.id, id, { status: "published" });
    console.log(`Đã tạo ${course.code}: ${course.title} (${unit.name}).`);
  }
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
