"""Sinh biểu đồ Chương 6 (SVG) từ số liệu trong docs/benchmarks/README.md.

Chạy: python docs/thesis/figures/ve-bieu-do-chuong-6.py docs/thesis/figures
Biểu đồ in trong báo cáo nên tĩnh: một trục y, nét mảnh, legend khi có ≥ 2 chuỗi.
"""
import sys
from pathlib import Path
from xml.sax.saxutils import escape

OUT = Path(sys.argv[1])
S1, S2 = "#2a78d6", "#eb6834"  # bảng màu tham chiếu, đã chạy validate_palette (light)
INK, INK2, MUTED, GRID, SURF = "#0b0b0b", "#52514e", "#8a8984", "#e6e5e1", "#ffffff"
FONT = "Arial, 'Segoe UI', sans-serif"


class Chart:
    def __init__(self, w, h):
        self.w, self.h, self.p = w, h, []

    def t(self, x, y, s, size=12, color=INK2, anchor="middle", bold=False, rotate=None, halo=False):
        tr = f' transform="rotate({rotate} {x} {y})"' if rotate is not None else ""
        b = ' font-weight="700"' if bold else ""
        if halo:  # viền trắng để số đọc được khi nằm trên đường kẻ
            b += f' stroke="{SURF}" stroke-width="3" paint-order="stroke"'
        self.p.append(
            f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" fill="{color}" text-anchor="{anchor}"{b}{tr}>{escape(s)}</text>'
        )

    def raw(self, s):
        self.p.append(s)

    def save(self, name):
        svg = (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" viewBox="0 0 {self.w} {self.h}" '
            f'font-family="{FONT}"><rect width="100%" height="100%" fill="{SURF}"/>' + "".join(self.p) + "</svg>"
        )
        (OUT / name).write_text(svg, encoding="utf-8")


def axes(c, x0, y0, w, h, ymin, ymax, ticks, ylabel, fmt=lambda v: f"{v:g}"):
    """Lưới ngang mờ, nhãn trục y; trả về hàm đổi giá trị → toạ độ y."""
    Y = lambda v: y0 + h - (v - ymin) / (ymax - ymin) * h
    for v in ticks:
        c.raw(f'<line x1="{x0}" y1="{Y(v):.1f}" x2="{x0 + w}" y2="{Y(v):.1f}" stroke="{GRID}" stroke-width="1"/>')
        c.t(x0 - 8, Y(v) + 4, fmt(v), 11, MUTED, "end")
    c.raw(f'<line x1="{x0}" y1="{y0 + h}" x2="{x0 + w}" y2="{y0 + h}" stroke="{MUTED}" stroke-width="1"/>')
    c.t(x0 - 46, y0 + h / 2, ylabel, 12, INK2, rotate=-90)
    return Y


def bar(c, x, w, ytop, ybase, color):
    """Cột có góc bo 4px ở đầu dữ liệu, chân vuông nằm trên đường gốc."""
    r = min(4, w / 2, max(0, ybase - ytop))
    c.raw(
        f'<path d="M{x:.1f},{ybase:.1f} V{ytop + r:.1f} Q{x:.1f},{ytop:.1f} {x + r:.1f},{ytop:.1f} '
        f'H{x + w - r:.1f} Q{x + w:.1f},{ytop:.1f} {x + w:.1f},{ytop + r:.1f} V{ybase:.1f} Z" fill="{color}"/>'
    )


def legend(c, x, y, items):
    for label, color in items:
        c.raw(f'<rect x="{x}" y="{y - 9}" width="12" height="12" rx="2" fill="{color}"/>')
        c.t(x + 18, y + 1, label, 12, INK, "start")
        x += 26 + len(label) * 6.6


def line_series(c, X, Y, xs, ys, color, label=None, label_dy=-10):
    pts = " ".join(f"{X(a):.1f},{Y(b):.1f}" for a, b in zip(xs, ys))
    c.raw(f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="2" stroke-linejoin="round"/>')
    for a, b in zip(xs, ys):
        c.raw(f'<circle cx="{X(a):.1f}" cy="{Y(b):.1f}" r="4" fill="{color}" stroke="{SURF}" stroke-width="2"/>')
    if label:
        c.t(X(xs[-1]) + 8, Y(ys[-1]) + 4 + label_dy, label, 11, INK, "start")


# ------------------------------------------------------------ Hình 6.1: tải tổng đài
def fig_load():
    c = Chart(840, 380)
    levels = [20, 50, 100, 150, 200]
    setup_p95 = [330, 766, 1721, 2237, 2815]
    ivr_p50 = [1693, 1678, 1701, 1733, 3252]
    cpu_acd = [66, 164, 338, 467, 823]
    cpu_sipp_x = [25, 50, 100, 150, 200]
    cpu_sipp = [18.7, 28.5, 38.8, 56.1, 60.4]

    for i, (title, ymax, ticks, ylab) in enumerate(
        [
            ("(a) Thời gian xử lý của tầng ARI/ACD", 3500, range(0, 3501, 500), "mili giây"),
            ("(b) CPU của Asterisk", 900, range(0, 901, 150), "% một lõi CPU"),
        ]
    ):
        x0, y0, w, h = 70 + i * 420, 70, 320, 230
        c.t(x0 + w / 2 - 20, 26, title, 14, INK, bold=True)
        Y = axes(c, x0, y0, w, h, 0, ymax, ticks, ylab, fmt=lambda v: f"{v:,.0f}".replace(",", "."))
        X = lambda v, x0=x0, w=w: x0 + 10 + (v - 0) / 200 * (w - 20)
        for v in levels:
            c.t(X(v), y0 + h + 18, str(v), 11, MUTED)
        c.t(x0 + w / 2, y0 + h + 40, "Số cuộc gọi đồng thời", 12, INK2)
        if i == 0:
            line_series(c, X, Y, levels, setup_p95, S1)
            line_series(c, X, Y, levels, ivr_p50, S2)
            legend(c, x0, 52, [("Thiết lập cuộc gọi p95", S1), ("IVR → hàng đợi p50", S2)])
            c.t(X(200) + 9, Y(3252) + 4, "3.252", 11, INK, "start")
            c.t(X(200) + 9, Y(2815) + 4, "2.815", 11, INK, "start")
        else:
            line_series(c, X, Y, levels, cpu_acd, S1)
            line_series(c, X, Y, cpu_sipp_x, cpu_sipp, S2)
            legend(c, x0, 52, [("Lượt ACD (kênh Local)", S1), ("Lượt SIPp", S2)])
            c.t(X(200) - 6, Y(823) - 10, "823%", 11, INK, "end")
            c.t(X(200) - 6, Y(60.4) - 12, "60%", 11, INK, "end", halo=True)
    c.t(420, 366, "Tỉ lệ thành công 100% ở mọi mức (ACD: 1.040/1.040 cuộc; SIPp: 1.220/1.220 cuộc). Một máy, Docker Desktop/WSL2.", 11, MUTED)
    c.save("fig-6-1-tai-tong-dai.svg")


# ------------------------------------------------------------ Hình 6.2: MOS
def fig_mos():
    c = Chart(840, 380)
    nets = ["LAN", "Wi-Fi\n20±5 ms", "4G\n60±15 ms, 0,5%", "4G yếu\n120±30 ms, 2%", "Quá tải\n200±40 ms, 5%"]
    calls = [(4.39, 4.39), (4.38, 4.38), (4.32, 4.29), (3.94, 4.00), (2.91, 3.06)]
    x0, y0, w, h = 90, 40, 700, 250
    Y = axes(c, x0, y0, w, h, 1, 4.5, [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5], "MOS (E-model)", fmt=lambda v: f"{v:.1f}".replace(".", ","))
    slot = w / len(nets)
    bw = 22
    for i, (n, (a, b)) in enumerate(zip(nets, calls)):
        cx = x0 + slot * (i + 0.5)
        bar(c, cx - bw - 1, bw, Y(a), Y(1), S1)  # 2px khe giữa hai cột
        bar(c, cx + 1, bw, Y(b), Y(1), S1)
        # nhãn của cột sát ngưỡng 4,0 được nâng lên trên đường kẻ
        ly = lambda v: (Y(4.0) if 3.85 <= v <= 4.05 else Y(v)) - 6
        c.t(cx - bw / 2 - 1, ly(a), f"{a:.2f}".replace(".", ","), 11, INK, halo=True)
        c.t(cx + bw / 2 + 1, ly(b), f"{b:.2f}".replace(".", ","), 11, INK, halo=True)
        for k, part in enumerate(n.split("\n")):
            c.t(cx, y0 + h + 18 + k * 15, part, 11 if k else 12, INK2 if k == 0 else MUTED)
    for v, label in [(4.0, "Mục tiêu MOS 4,0")]:
        c.raw(f'<line x1="{x0}" y1="{Y(v):.1f}" x2="{x0 + w}" y2="{Y(v):.1f}" stroke="{INK2}" stroke-width="1.2" stroke-dasharray="5 4"/>')
    c.t(x0 + w - 4, Y(4.0) + 14, "Mục tiêu MOS 4,0", 11, INK2, "end")
    c.t(420, 366, "Mỗi nhóm 2 cuộc gọi SIPp 30 s; mạng của người gọi giả lập bằng tc netem; G.711 có che mất gói (Bpl = 25,1); trần lý thuyết ≈ 4,41.", 11, MUTED)
    c.save("fig-6-2-mos-theo-mang.svg")


# ------------------------------------------------------------ Hình 6.3: KPI ca trực
def fig_kpi():
    c = Chart(840, 340)
    panels = [
        ("ASA (giây)", 9.8, 32.1, 20, "≤ 20 s", 40, [0, 10, 20, 30, 40]),
        ("Tỉ lệ bỏ máy (%)", 3.6, 3.6, 5, "≤ 5%", 10, [0, 2, 4, 6, 8, 10]),
        ("Service level 20 s (%)", 88.5, 60.0, 80, "≥ 80%", 100, [0, 20, 40, 60, 80, 100]),
    ]
    legend(c, 300, 24, [("Ca thường", S1), ("Ca cao điểm", S2)])
    for i, (title, a, b, target, tl, ymax, ticks) in enumerate(panels):
        x0, y0, w, h = 70 + i * 270, 70, 190, 200
        c.t(x0 + w / 2, 58, title, 13, INK, bold=True)
        Y = axes(c, x0, y0, w, h, 0, ymax, ticks, "", fmt=lambda v: f"{v:g}")
        bw = 40
        cx = x0 + w / 2
        bar(c, cx - bw - 1, bw, Y(a), Y(0), S1)
        bar(c, cx + 1, bw, Y(b), Y(0), S2)
        c.t(cx - bw / 2 - 1, Y(a) - 6, f"{a:g}".replace(".", ","), 11, INK)
        c.t(cx + bw / 2 + 1, Y(b) - 6, f"{b:g}".replace(".", ","), 11, INK)
        c.raw(f'<line x1="{x0}" y1="{Y(target):.1f}" x2="{x0 + w}" y2="{Y(target):.1f}" stroke="{INK2}" stroke-width="1.2" stroke-dasharray="5 4"/>')
        if i == 0:  # cột cam vượt mục tiêu nằm bên phải, nên đặt nhãn bên trái
            c.t(x0 + 2, Y(target) - 6, f"mục tiêu {tl}", 11, INK2, "start", halo=True)
        else:
            c.t(x0 + w, Y(target) - 6, f"mục tiêu {tl}", 11, INK2, "end", halo=True)
    c.t(420, 326, "28 cuộc mỗi ca, 3 tổng đài viên; ACD và PostgreSQL thật, PBX giả lập; KPI tính bằng cùng hàm kpiSummary của trang KPI.", 11, MUTED)
    c.save("fig-6-3-kpi-ca-truc.svg")


fig_load()
fig_mos()
fig_kpi()
print("ok")
