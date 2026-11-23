"""Sinh 5 hình SVG cho Chương 2, cùng phong cách với hinh-2-1-mesh-mcu-sfu.svg."""
import sys
from pathlib import Path
from xml.sax.saxutils import escape

OUT = Path(sys.argv[1])
BLUE, FILL, INK, GREY = "#2b4c7e", "#eef3fb", "#111", "#666"
ORANGE, OFILL = "#b5651d", "#fdf1e6"
GREEN, GFILL = "#2e7d32", "#ebf5ec"


class Svg:
    def __init__(self, w, h):
        self.w, self.h, self.parts = w, h, []

    def add(self, s):
        self.parts.append(s)

    def text(self, x, y, lines, size=13, bold=False, anchor="middle", color=INK, italic=False):
        if isinstance(lines, str):
            lines = lines.split("\n")
        lh = size * 1.28
        y0 = y - (len(lines) - 1) * lh / 2 + size * 0.35
        spans = "".join(
            f'<tspan x="{x}" y="{y0 + i * lh:.1f}">{escape(l)}</tspan>' for i, l in enumerate(lines)
        )
        w = ' font-weight="700"' if bold else ""
        it = ' font-style="italic"' if italic else ""
        self.add(f'<text text-anchor="{anchor}" font-size="{size}" fill="{color}"{w}{it}>{spans}</text>')

    def box(self, x, y, w, h, label="", size=13, bold=False, stroke=BLUE, fill=FILL, rx=6, dash=False):
        d = ' stroke-dasharray="5 4"' if dash else ""
        self.add(
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="1.5"{d}/>'
        )
        if label:
            self.text(x + w / 2, y + h / 2, label, size, bold)

    def line(self, x1, y1, x2, y2, color=BLUE, width=1.6, dash=False, end=False, start=False):
        d = ' stroke-dasharray="6 4"' if dash else ""
        m = ""
        if end:
            m += f' marker-end="url(#a{color[1:]})"'
        if start:
            m += f' marker-start="url(#a{color[1:]})"'
        self.add(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="{width}"{d}{m}/>')

    def cloud(self, cx, cy, rx, ry, label):
        self.add(f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="#f4f4f4" stroke="{GREY}" stroke-width="1.5"/>')
        self.text(cx, cy, label, 13, True)

    def save(self, name):
        colors = {BLUE, INK, GREY, ORANGE, GREEN}
        markers = "".join(
            f'<marker id="a{c[1:]}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" '
            f'orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{c}"/></marker>'
            for c in colors
        )
        svg = (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" '
            f'viewBox="0 0 {self.w} {self.h}" font-family="Arial, \'Segoe UI\', sans-serif">'
            f'<defs>{markers}</defs><rect width="100%" height="100%" fill="#fff"/>'
            + "".join(self.parts)
            + "</svg>"
        )
        (OUT / name).write_text(svg, encoding="utf-8")


def msg(s, x1, x2, y, label, color=INK, dash=False, size=12):
    """Mũi tên ngang trong biểu đồ tuần tự, nhãn đặt phía trên."""
    w = len(label) * size * 0.56 + 8
    s.add(f'<rect x="{(x1 + x2) / 2 - w / 2:.1f}" y="{y - 9 - size * 0.75:.1f}" width="{w:.1f}" height="{size * 1.4:.1f}" fill="#fff"/>')
    s.line(x1, y, x2, y, color, 1.4, dash, end=True)
    s.text((x1 + x2) / 2, y - 9, label, size, color=color)


def lifelines(s, cols, top, bottom):
    for x, label in cols:
        s.box(x - 75, top, 150, 46, label, 13, True)
        s.line(x, top + 46, x, bottom, GREY, 1.2, dash=True)


def phase(s, y1, y2, label):
    s.add(f'<line x1="22" y1="{y1}" x2="22" y2="{y2}" stroke="{BLUE}" stroke-width="3"/>')
    mid = (y1 + y2) / 2
    s.add(
        f'<text transform="translate(14 {mid}) rotate(-90)" text-anchor="middle" font-size="12" '
        f'fill="{BLUE}" font-weight="700">{escape(label)}</text>'
    )


# ---------------------------------------------------------------- Hình 2.1
def fig_2_1():
    s = Svg(840, 400)
    s.text(205, 28, "(a) Tổng đài PBX truyền thống", 16, True)
    s.text(630, 28, "(b) Tổng đài IP (IP-PBX) với SIP trunk", 16, True)
    s.line(420, 50, 420, 330, "#ddd", 1)

    # (a)
    for i, y in enumerate([70, 125, 180]):
        s.box(20, y, 86, 34, f"Máy lẻ {101 + i}", 12)
        s.line(106, y + 17, 160, 150, GREY, 1.4)
    s.box(160, 122, 96, 56, "PBX\ncơ sở 1", 13, True)
    s.box(160, 252, 96, 56, "PBX\ncơ sở 2", 13, True)
    s.cloud(345, 210, 55, 34, "PSTN")
    s.line(256, 150, 300, 192, ORANGE, 2.4)
    s.line(256, 280, 300, 228, ORANGE, 2.4)
    s.text(320, 150, "trung kế thuê\n(tính cước)", 11, color=ORANGE)
    s.text(320, 278, "gọi liên cơ sở\nvẫn qua PSTN", 11, color=ORANGE)
    s.text(60, 230, "dây đồng riêng\ncho từng máy", 11, color=GREY)

    # (b)
    devs = ["Điện thoại IP", "Softphone (Zoiper)", "Trình duyệt (JsSIP)"]
    for i, d in enumerate(devs):
        y = 70 + i * 60
        s.box(440, y, 130, 34, d, 12)
        s.line(570, y + 17, 600, y + 17, BLUE, 1.6)
    s.add(f'<rect x="600" y="64" width="12" height="190" fill="{BLUE}" opacity="0.85"/>')
    s.text(606, 272, "Mạng IP của trường", 11, color=BLUE)
    s.line(612, 120, 650, 120, BLUE, 1.6)
    s.box(650, 92, 120, 56, "IP-PBX\n(Asterisk)", 13, True)
    s.line(710, 148, 710, 196, ORANGE, 2.4, end=True, start=True)
    s.text(758, 172, "SIP trunk", 11, color=ORANGE)
    s.box(650, 196, 120, 44, "Nhà cung cấp\n(Pitel)", 12)
    s.line(710, 240, 710, 268, ORANGE, 2.4)
    s.cloud(710, 292, 50, 24, "PSTN")
    s.text(505, 262, "gọi nội bộ qua SIP:\nkhông tính cước", 11, color=GREEN)

    s.text(205, 360, "Mỗi máy một đường dây; mở rộng phải đi dây,\nmở cổng; ít dữ liệu thống kê, ghi âm", 12)
    s.text(630, 360, "Chung hạ tầng mạng; chỉ tính cước khi gọi ra\nngoài qua SIP trunk; phần mềm ghi CDR, ghi âm", 12)
    s.save("hinh-2-1-pbx-ippbx.svg")


# ---------------------------------------------------------------- Hình 2.2
def fig_2_2():
    s = Svg(840, 700)
    A, P, B = 160, 420, 690
    lifelines(s, [(A, "Máy A (UAC)"), (P, "Asterisk (B2BUA)"), (B, "Máy B (UAS)")], 20, 676)
    y = 105
    y0 = y
    msg(s, B, P, y, "REGISTER"); y += 28
    msg(s, P, B, y, "401 Unauthorized (nonce)"); y += 28
    msg(s, B, P, y, "REGISTER + digest"); y += 28
    msg(s, P, B, y, "200 OK")
    phase(s, y0 - 18, y + 6, "Đăng ký"); y += 48

    y0 = y
    msg(s, A, P, y, "INVITE (SDP đề nghị)"); y += 28
    msg(s, P, A, y, "100 Trying", GREY); y += 28
    msg(s, P, B, y, "INVITE (SDP mới)"); y += 28
    msg(s, B, P, y, "180 Ringing"); y += 28
    msg(s, P, A, y, "180 Ringing"); y += 28
    msg(s, B, P, y, "200 OK (SDP trả lời)"); y += 28
    msg(s, P, A, y, "200 OK (SDP)"); y += 28
    msg(s, A, P, y, "ACK"); y += 28
    msg(s, P, B, y, "ACK")
    phase(s, y0 - 18, y + 6, "Thiết lập"); y += 52

    y0 = y
    for x1, x2, label in [(A, P, "RTP chặng 1"), (P, B, "RTP chặng 2")]:
        s.line(x1 + 4, y, x2 - 4, y, ORANGE, 2.2, dash=True, end=True, start=True)
        s.text((x1 + x2) / 2, y - 11, label, 12, True, color=ORANGE)
    s.add(f'<rect x="{P - 140}" y="{y + 12}" width="280" height="18" fill="#fff"/>')
    s.text(P, y + 21, "ghi âm · chuyển mã · nghe xen tại tổng đài", 11, color=ORANGE, italic=True)
    phase(s, y0 - 30, y + 30, "Đàm thoại"); y += 68

    y0 = y
    msg(s, A, P, y, "BYE"); y += 28
    msg(s, P, B, y, "BYE"); y += 28
    msg(s, B, P, y, "200 OK"); y += 28
    msg(s, P, A, y, "200 OK")
    phase(s, y0 - 18, y + 6, "Kết thúc")
    s.save("hinh-2-2-sip-b2bua.svg")


# ---------------------------------------------------------------- Hình 2.3
def stack(s, x, y, w, items, stroke=BLUE, fill=FILL, h=30):
    for i, it in enumerate(items):
        s.box(x, y + i * h, w, h, it, 12, stroke=stroke, fill=fill, rx=0)


def fig_2_3():
    s = Svg(840, 470)
    cols = [(30, "Trình duyệt"), (320, "Asterisk"), (610, "Nhà cung cấp SIP trunk")]
    W = 200
    for x, label in cols:
        s.text(x + W / 2, 30, label, 15, True)
    s.text(30, 62, "Báo hiệu", 13, True, anchor="start", color=BLUE)
    s.text(30, 262, "Media", 13, True, anchor="start", color=ORANGE)

    y1 = 75
    stack(s, 30, y1, W, ["JsSIP (UA SIP)", "SIP", "WebSocket (WSS)", "TLS / TCP", "IP"])
    stack(s, 320, y1, W, ["chan_pjsip (B2BUA)", "SIP", "transport-ws", "TLS / TCP", "IP"])
    stack(s, 610, y1, W, ["Tổng đài nhà mạng", "SIP", "UDP 5060", "IP"])
    s.line(230, y1 + 45, 320, y1 + 45, BLUE, 2, end=True, start=True)
    s.line(520, y1 + 45, 610, y1 + 45, BLUE, 2, end=True, start=True)
    s.text(275, y1 + 30, "REGISTER,\nINVITE…", 10, color=BLUE)
    s.text(565, y1 + 30, "INVITE,\nBYE…", 10, color=BLUE)

    y2 = 275
    stack(s, 30, y2, W, ["Opus", "SRTP (khóa từ DTLS)", "ICE · STUN / TURN", "UDP", "IP"], ORANGE, OFILL)
    stack(s, 320, y2, W, ["Chuyển mã Opus ↔ G.711", "SRTP  |  RTP", "ICE (webrtc=yes)", "UDP 10000–10499", "IP"], ORANGE, OFILL)
    stack(s, 610, y2, W, ["G.711", "RTP", "UDP", "IP"], ORANGE, OFILL)
    s.line(230, y2 + 45, 320, y2 + 45, ORANGE, 2, end=True, start=True)
    s.line(520, y2 + 45, 610, y2 + 45, ORANGE, 2, end=True, start=True)
    s.text(275, y2 + 30, "mã hóa\nDTLS-SRTP", 10, color=ORANGE)
    s.text(565, y2 + 30, "RTP thường", 10, color=ORANGE)

    s.text(420, 445, "Chặng trình duyệt dùng WebRTC (Opus, DTLS-SRTP, ICE); chặng trunk dùng SIP/UDP và G.711. "
           "Asterisk là B2BUA nối hai chặng và chuyển mã.", 11, color=GREY)
    s.save("hinh-2-3-softphone-web.svg")


# ---------------------------------------------------------------- Hình 2.4
def fig_2_4():
    s = Svg(840, 400)
    s.text(205, 28, "(a) Lõi và các nhóm mô-đun", 16, True)
    s.text(630, 28, "(b) Một cuộc gọi: hai kênh nối qua cầu", 16, True)
    s.line(420, 50, 420, 340, "#ddd", 1)

    s.box(125, 165, 170, 66, "Lõi Asterisk\n(PBX core, dial plan)", 13, True, fill="#dfe8f6")
    mods = [
        (20, 60, "Trình điều khiển kênh\nchan_pjsip"),
        (220, 60, "Ứng dụng\nDial, Playback, Stasis"),
        (20, 280, "Codec, chuyển mã\nOpus · G.722 · G.711"),
        (220, 280, "Tài nguyên\nMOH · HTTP/WS · ARI"),
    ]
    for x, y, label in mods:
        s.box(x, y, 180, 52, label, 12)
        cx, cy = x + 90, y + (52 if y < 165 else 0)
        s.line(cx, cy, 210 + (cx - 210) * 0.45, 165 if y < 165 else 231, BLUE, 1.4)

    # (b)
    s.box(440, 60, 120, 36, "Trình duyệt\n(máy lẻ 101)", 11, stroke=GREY, fill="#f4f4f4")
    s.box(710, 60, 120, 36, "Người gọi\nqua trunk", 11, stroke=GREY, fill="#f4f4f4")
    s.line(500, 96, 500, 130, GREY, 1.4, end=True, start=True)
    s.line(770, 96, 770, 130, GREY, 1.4, end=True, start=True)
    s.box(440, 130, 120, 50, "Kênh 1\nPJSIP/101-…", 12, True)
    s.box(710, 130, 120, 50, "Kênh 2\nPJSIP/trunk-…", 12, True)
    s.box(585, 130, 100, 50, "Cầu nối\n(mixing)", 12, True, stroke=ORANGE, fill=OFILL)
    s.line(560, 155, 585, 155, ORANGE, 2, end=True, start=True)
    s.line(685, 155, 710, 155, ORANGE, 2, end=True, start=True)

    s.box(585, 225, 100, 44, "Ghi âm\ncầu nối", 12, stroke=GREEN, fill=GFILL)
    s.line(635, 180, 635, 225, GREEN, 1.6, end=True)
    s.box(440, 225, 120, 44, "Kênh snoop\n(nghe, nhắc nhỏ)", 11, dash=True)
    s.line(500, 225, 500, 180, BLUE, 1.4, dash=True, end=True)
    s.box(710, 225, 120, 44, "Kênh giám sát\n(tham gia)", 11, dash=True)
    s.line(740, 225, 670, 180, BLUE, 1.4, dash=True, end=True)

    s.text(205, 362, "Mỗi chức năng là một mô-đun nạp động quanh một lõi nhỏ", 12)
    s.text(630, 362, "Ghi âm, nghe xen, tham gia đều là thao tác\nthêm kênh hoặc gắn vào cầu nối", 12)
    s.save("hinh-2-4-asterisk-kenh-cau.svg")


# ---------------------------------------------------------------- Hình 2.5
def fig_2_5():
    s = Svg(840, 690)
    C, A, W, T = 95, 300, 545, 750
    lifelines(s, [(C, "Người gọi"), (A, "Asterisk"), (W, "Web app (ACD)"), (T, "Tổng đài viên")], 20, 640)
    y = 100
    msg(s, C, A, y, "INVITE (hotline)", GREY); y += 30
    s.box(A - 95, y - 12, 190, 34, "from-trunk →\nStasis(tworkspace, inbound)", 11, stroke=GREY, fill="#f4f4f4"); y += 52
    msg(s, A, W, y, "StasisStart", ORANGE, dash=True); y += 32
    msg(s, W, A, y, "POST /channels/{id}/answer", BLUE); y += 30
    msg(s, W, A, y, "POST …/play (lời chào)", BLUE); y += 30
    msg(s, W, A, y, "POST …/moh (nhạc chờ)", BLUE); y += 26
    s.box(W - 85, y, 170, 36, "ACD chọn TĐV Sẵn sàng\nrảnh lâu nhất (BR-02, 03)", 11, stroke=GREEN, fill=GFILL); y += 66
    msg(s, W, A, y, "POST /channels/create + /dial", BLUE); y += 30
    msg(s, A, T, y, "INVITE (SIP/WSS)", GREY); y += 30
    msg(s, T, A, y, "200 OK", GREY); y += 30
    msg(s, A, W, y, "ChannelStateChange: Up", ORANGE, dash=True); y += 30
    msg(s, W, A, y, "POST /bridges + addChannel + record", BLUE); y += 38
    s.line(C + 4, y, T - 4, y, ORANGE, 2.2, dash=True, end=True, start=True)
    s.add(f'<rect x="{(C + T) / 2 - 150}" y="{y - 22}" width="300" height="18" fill="#fff"/>')
    s.text((C + T) / 2, y - 13, "Đàm thoại: RTP qua cầu nối, đang ghi âm", 12, True, color=ORANGE); y += 40
    msg(s, C, A, y, "BYE", GREY); y += 30
    msg(s, A, W, y, "StasisEnd", ORANGE, dash=True); y += 18
    s.box(W - 85, y, 170, 36, "Wrap-up, mã kết quả,\nlưu CDR (BR-07)", 11, stroke=GREEN, fill=GFILL)

    ly = 668
    for i, (c, d, label) in enumerate([(BLUE, False, "Lệnh REST của ARI"), (ORANGE, True, "Sự kiện qua WebSocket"), (GREY, False, "Báo hiệu SIP")]):
        x = 150 + i * 220
        s.line(x, ly, x + 40, ly, c, 1.6, d, end=True)
        s.text(x + 48, ly, label, 12, anchor="start")
    s.save("hinh-2-5-stasis-ari.svg")


for f in (fig_2_1, fig_2_2, fig_2_3, fig_2_4, fig_2_5):
    f()
print("ok")
