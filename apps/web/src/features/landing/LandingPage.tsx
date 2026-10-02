import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ArrowUpRight, Video, MessageSquare, CheckSquare } from "lucide-react";
import { useApp } from "../../app/providers/AppContext";
import "./editorial.css";

const spacesList = [
  {
    id: "meetings",
    name: "Phòng Họp Trực Tuyến SFU",
    location: "Hội nghị truyền hình đa điểm",
    specs: "SFU mediasoup · Video 1080p · Âm thanh Studio",
    badge: "Truyền thông SFU",
    desc: "Phòng họp hội nghị thời gian thực với công nghệ định tuyến SFU, tối ưu hóa băng thông, chia sẻ màn hình mượt mà và kiểm soát độ trễ dưới 50ms.",
    gradient: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)",
    icon: Video,
  },
  {
    id: "chat",
    name: "Kênh Thảo Luận Nhóm",
    location: "Trao đổi tức thời đa kênh",
    specs: "Socket.IO · Đồng bộ tức thời · Đính kèm tệp",
    badge: "Tin nhắn Realtime",
    desc: "Không gian trò chuyện trực tuyến phân kênh theo dự án, lưu trữ toàn vẹn lịch sử tin nhắn và đồng bộ tức thời đến mọi thành viên.",
    gradient: "linear-gradient(135deg, #334155 0%, #1e293b 100%)",
    icon: MessageSquare,
  },
  {
    id: "tasks",
    name: "Bảng Quản Lý Công Việc",
    location: "Điều phối tiến độ dự án",
    specs: "Kanban đa trạng thái · Phân quyền thành viên",
    badge: "Cộng tác nhóm",
    desc: "Theo dõi tiến độ công việc trực quan, phân công nhiệm vụ linh hoạt và quản lý quyền hạn thành viên chặt chẽ theo vai trò nhóm.",
    gradient: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)",
    icon: CheckSquare,
  },
];

const architecturePillars = [
  {
    num: "01",
    title: "Lõi Định Tuyến SFU mediasoup",
    desc: "Hạ tầng máy chủ chọn lọc và chuyển tiếp luồng truyền thông (Selective Forwarding Unit), loại bỏ gánh nặng mã hóa ở client và mở rộng phòng họp lên hàng chục người tham gia đồng thời.",
  },
  {
    num: "02",
    title: "Đo Kiểm & Kiểm Soát QoS Thời Gian Thực",
    desc: "Thu thập liên tục các thông số mạng RTP từ WebRTC Stats API: độ trễ (RTT), tỉ lệ mất gói (Packet Loss) và biến động gói (Jitter) để tự động điều chỉnh độ phân giải phù hợp.",
  },
  {
    num: "03",
    title: "Kiến Trúc Phân Tầng Monorepo",
    desc: "Cấu trúc mã nguồn module hóa rõ ràng giữa lõi định nghĩa kiểu dữ liệu dùng chung (@doan/shared), dịch vụ điều phối thời gian thực (@doan/api) và ứng dụng web React hiệu năng cao (@doan/web).",
  },
];

const journalArticles = [
  {
    issue: "Chuyên đề 01",
    readTime: "7 phút đọc",
    title: "Nghiên cứu và Triển khai Hạ tầng Hội nghị SFU với mediasoup",
    excerpt:
      "Khảo sát kiến trúc truyền thông WebRTC đa điểm, phân tích ưu nhược điểm giữa Mesh P2P, MCU và SFU trong môi trường mạng thực tế.",
  },
  {
    issue: "Chuyên đề 02",
    readTime: "10 phút đọc",
    title: "Kiểm Soát Chất Lượng Mạng QoS và Thuật Toán Bù Trừ Độ Trễ",
    excerpt:
      "Phương pháp thiết kế mô-đun giám sát chất lượng kết nối thời gian thực, đo lường các chỉ số băng thông và đưa ra cảnh báo mạng tức thời.",
  },
  {
    issue: "Chuyên đề 03",
    readTime: "6 phút đọc",
    title: "Ngôn Ngữ Thiết Kế Minimalist Editorial Cho Ứng Dụng Cộng Tác",
    excerpt:
      "Ứng dụng nghệ thuật typography Instrument Serif và chuyển động tĩnh tại giúp người dùng đạt trạng thái tập trung sâu khi làm việc nhóm.",
  },
];

export function LandingPage() {
  const { openAuth, enterWorkspace, user, notify } = useApp();
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 40);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      const navOffset = 80;
      const targetPos = el.getBoundingClientRect().top + window.scrollY - navOffset;
      window.scrollTo({ top: targetPos, behavior: "smooth" });
    }
  };

  const handleHeroCta = () => {
    if (user) {
      enterWorkspace();
    } else {
      openAuth("register");
    }
  };

  const handleNavCta = () => {
    if (user) {
      enterWorkspace();
    } else {
      openAuth("login");
    }
  };

  return (
    <div className="editorial-shell">
      {/* Sticky Navigation Bar */}
      <header className={`editorial-nav-bar ${isScrolled ? "is-scrolled" : ""}`}>
        <nav className="editorial-nav" aria-label="Điều hướng chính">
          {/* Left Col: Brand Logo */}
          <div className="editorial-nav-left">
            <button
              type="button"
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="editorial-brand"
            >
              CollabSpace<sup>®</sup>
            </button>
          </div>

          {/* Center Col: 4 Links with Smooth Scroll */}
          <div className="editorial-nav-center">
            <button
              type="button"
              onClick={() => scrollToSection("residences")}
              className="editorial-nav-link"
            >
              Không gian
            </button>
            <button
              type="button"
              onClick={() => scrollToSection("architecture")}
              className="editorial-nav-link"
            >
              Kiến trúc
            </button>
            <button
              type="button"
              onClick={() => scrollToSection("philosophy")}
              className="editorial-nav-link"
            >
              Triết lý
            </button>
            <button
              type="button"
              onClick={() => scrollToSection("journal")}
              className="editorial-nav-link"
            >
              Chuyên khảo
            </button>
          </div>

          {/* Right Col: CTA Button */}
          <div className="editorial-nav-right">
            <button
              type="button"
              onClick={handleNavCta}
              className="editorial-pill-btn editorial-pill-btn--sm"
            >
              {user ? "Vào không gian" : "Bắt đầu ngay"}
            </button>
          </div>
        </nav>
      </header>

      {/* ====================================================================
          Hero Section (Editorial Cinematic)
          ==================================================================== */}
      <div className="editorial-hero-wrapper">
        <main className="editorial-hero">
          <h1 className="editorial-heading editorial-stagger-h1">
            Không gian cộng tác thời gian thực
          </h1>

          <p className="editorial-paragraph editorial-stagger-p">
            Nền tảng làm việc nhóm tích hợp trao đổi tức thời và hội nghị truyền hình WebRTC SFU độ
            trễ thấp. Nơi mọi kết nối hội tụ liền mạch, tĩnh tại và bảo mật.
          </p>

          <div className="editorial-stagger-cta">
            <button
              type="button"
              onClick={handleHeroCta}
              className="editorial-pill-btn editorial-pill-btn--lg"
            >
              {user ? "Vào không gian làm việc" : "Khám phá không gian"}
            </button>
          </div>
        </main>
      </div>

      {/* ====================================================================
          Section 1: Không gian (#residences)
          ==================================================================== */}
      <section id="residences" className="editorial-section">
        <motion.div
          className="editorial-section-head"
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          <span className="editorial-tag">Hệ sinh thái cộng tác</span>
          <h2 className="editorial-title">Không gian chuyên biệt</h2>
          <p className="editorial-subtitle">
            Tập trung cao độ với các phân khu chức năng được thiết kế tinh giản, tối ưu hóa trải
            nghiệm tương tác nhóm mà không gây nhiễu loạn thị giác.
          </p>
        </motion.div>

        <div className="editorial-residences-grid">
          {spacesList.map((space, idx) => {
            const IconComponent = space.icon;
            return (
              <motion.div
                key={space.id}
                className="editorial-residence-card"
                initial={{ opacity: 0, y: 36 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.15 }}
                transition={{
                  duration: 0.75,
                  delay: idx * 0.15,
                  ease: [0.16, 1, 0.3, 1],
                }}
                onClick={() =>
                  notify(
                    space.name,
                    `${space.location} — Không gian sẵn sàng phục vụ làm việc nhóm.`,
                    "info",
                  )
                }
              >
                <div className="editorial-residence-media">
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      background: space.gradient,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                    className="editorial-residence-img"
                  >
                    <IconComponent
                      style={{ color: "rgba(255, 255, 255, 0.35)", width: 48, height: 48 }}
                    />
                  </div>
                  <span className="editorial-residence-badge">{space.badge}</span>
                </div>

                <div className="editorial-residence-body">
                  <h3 className="editorial-residence-name">{space.name}</h3>
                  <p className="editorial-residence-desc">{space.desc}</p>
                  <div className="editorial-residence-specs">
                    <span>{space.location}</span>
                    <strong>{space.specs}</strong>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* ====================================================================
          Section 2: Kiến trúc công nghệ (#architecture)
          ==================================================================== */}
      <section id="architecture" className="editorial-section editorial-section--warm">
        <div className="editorial-section-inner">
          <motion.div
            className="editorial-section-head"
            initial={{ opacity: 0, y: 32 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="editorial-tag">Nền tảng kỹ thuật</span>
            <h2 className="editorial-title">Kiến trúc phân tán SFU</h2>
            <p className="editorial-subtitle">
              Sự kết hợp giữa công nghệ định tuyến WebRTC tiên tiến và kiến trúc phần mềm chuẩn mực
              cho đồ án tốt nghiệp kỹ thuật.
            </p>
          </motion.div>

          <div className="editorial-arch-grid">
            {architecturePillars.map((pillar, idx) => (
              <motion.div
                key={pillar.num}
                className="editorial-arch-item"
                initial={{ opacity: 0, y: 36 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.2 }}
                transition={{
                  duration: 0.75,
                  delay: idx * 0.15,
                  ease: [0.16, 1, 0.3, 1],
                }}
              >
                <span className="editorial-arch-num">{pillar.num}</span>
                <h3 className="editorial-arch-title">{pillar.title}</h3>
                <p className="editorial-arch-desc">{pillar.desc}</p>
              </motion.div>
            ))}
          </div>

          {/* Metrics Callout */}
          <motion.div
            className="editorial-metrics-bar"
            initial={{ opacity: 0, scale: 0.98 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            <div>
              <div className="editorial-metric-val">&lt; 35ms</div>
              <div className="editorial-metric-label">Độ trễ truyền thông SFU trung bình</div>
            </div>
            <div>
              <div className="editorial-metric-val">1080p / 60fps</div>
              <div className="editorial-metric-label">Chia sẻ màn hình chất lượng cao</div>
            </div>
            <div>
              <div className="editorial-metric-val">100% WebRTC</div>
              <div className="editorial-metric-label">
                Chuẩn giao thức mở, không cần cài đặt plugin
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ====================================================================
          Section 3: Triết lý thiết kế (#philosophy)
          ==================================================================== */}
      <section id="philosophy" className="editorial-section">
        <motion.div
          className="editorial-quote-box"
          initial={{ opacity: 0, y: 36 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.85, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="editorial-quote-text">
            “Sự tinh tế đỉnh cao không nằm ở việc thêm thắt tính năng, mà ở việc loại bỏ triệt để
            mọi tiếng ồn và sự xao nhãng.”
          </p>
          <span className="editorial-quote-author">
            Triết lý Thiết Kế Hệ Thống CollabSpace · Đồ án tốt nghiệp
          </span>
        </motion.div>

        <div className="editorial-principles">
          <motion.div
            className="editorial-principle-card"
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.7, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="editorial-principle-tag">01 / TỐI GIẢN GIAO DIỆN</div>
            <h3 className="editorial-principle-heading">Thanh lọc không gian</h3>
            <p className="editorial-principle-desc">
              Loại bỏ hoàn toàn những hiệu ứng rối mắt, đặt người dùng vào trung tâm của cuộc thảo
              luận và công việc sáng tạo.
            </p>
          </motion.div>

          <motion.div
            className="editorial-principle-card"
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.7, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="editorial-principle-tag">02 / TƯƠNG TÁC LIỀN MẠCH</div>
            <h3 className="editorial-principle-heading">Chuyển động tự nhiên</h3>
            <p className="editorial-principle-desc">
              Mọi tương tác từ gửi tin nhắn, bật tắt camera đến cuộn trang đều phản hồi tức thời với
              độ trễ tối thiểu và quán tính êm dịu.
            </p>
          </motion.div>

          <motion.div
            className="editorial-principle-card"
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.7, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="editorial-principle-tag">03 / BỀN BỈ & BẢO MẬT</div>
            <h3 className="editorial-principle-heading">Nền tảng vững chắc</h3>
            <p className="editorial-principle-desc">
              Bảo mật toàn diện với xác thực phiên làm việc an toàn, cơ sở dữ liệu PostgreSQL lưu
              trữ bền vững và phân quyền chặt chẽ.
            </p>
          </motion.div>
        </div>
      </section>

      {/* ====================================================================
          Section 4: Chuyên khảo nghiên cứu (#journal)
          ==================================================================== */}
      <section id="journal" className="editorial-section editorial-section--warm">
        <div className="editorial-section-inner">
          <motion.div
            className="editorial-section-head"
            initial={{ opacity: 0, y: 32 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="editorial-tag">Tài liệu & Báo cáo kỹ thuật</span>
            <h2 className="editorial-title">Chuyên khảo nghiên cứu</h2>
            <p className="editorial-subtitle">
              Tổng hợp các nội dung nghiên cứu chuyên sâu, giải pháp công nghệ và kết quả đo nghiệm
              phục vụ đề tài tốt nghiệp.
            </p>
          </motion.div>

          <div className="editorial-journal-grid">
            {journalArticles.map((article, idx) => (
              <motion.article
                key={article.issue}
                className="editorial-journal-card"
                initial={{ opacity: 0, y: 32 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.2 }}
                transition={{
                  duration: 0.75,
                  delay: idx * 0.15,
                  ease: [0.16, 1, 0.3, 1],
                }}
                onClick={() =>
                  notify(
                    article.title,
                    `${article.issue} · Nội dung báo cáo kỹ thuật đề tài tốt nghiệp.`,
                    "info",
                  )
                }
              >
                <div className="editorial-journal-meta">
                  <span>{article.issue}</span>
                  <span>{article.readTime}</span>
                </div>
                <h3 className="editorial-journal-title">{article.title}</h3>
                <p className="editorial-journal-excerpt">{article.excerpt}</p>
                <span className="editorial-journal-read">
                  <span>Đọc báo cáo</span>
                  <ArrowUpRight style={{ width: 14, height: 14 }} />
                </span>
              </motion.article>
            ))}
          </div>

          <div style={{ textAlign: "center", marginTop: "24px" }}>
            <button
              type="button"
              onClick={handleHeroCta}
              className="editorial-pill-btn editorial-pill-btn--lg"
            >
              {user ? "Vào không gian làm việc" : "Trải nghiệm hệ thống ngay"}
            </button>
          </div>
        </div>
      </section>

      {/* ====================================================================
          Footer
          ==================================================================== */}
      <footer className="editorial-footer">
        <div className="editorial-footer-inner">
          <div className="editorial-footer-top">
            <div className="editorial-footer-brand-block">
              <span
                className="editorial-brand"
                style={{ display: "inline-block", marginBottom: "12px" }}
              >
                CollabSpace<sup>®</sup>
              </span>
              <p
                style={{
                  fontSize: "14px",
                  lineHeight: "1.6",
                  color: "hsl(215, 25%, 40%)",
                  margin: 0,
                }}
              >
                Hệ sinh thái không gian làm việc cộng tác thời gian thực và hội nghị truyền hình
                WebRTC SFU.
              </p>
            </div>

            <div style={{ display: "flex", gap: "48px", flexWrap: "wrap" }}>
              <div>
                <strong
                  style={{
                    display: "block",
                    fontSize: "12px",
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    marginBottom: "12px",
                  }}
                >
                  Điều hướng
                </strong>
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    fontSize: "14px",
                  }}
                >
                  <li>
                    <button
                      type="button"
                      onClick={() => scrollToSection("residences")}
                      className="editorial-nav-link"
                    >
                      Không gian
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      onClick={() => scrollToSection("architecture")}
                      className="editorial-nav-link"
                    >
                      Kiến trúc
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      onClick={() => scrollToSection("philosophy")}
                      className="editorial-nav-link"
                    >
                      Triết lý
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      onClick={() => scrollToSection("journal")}
                      className="editorial-nav-link"
                    >
                      Chuyên khảo
                    </button>
                  </li>
                </ul>
              </div>

              <div>
                <strong
                  style={{
                    display: "block",
                    fontSize: "12px",
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    marginBottom: "12px",
                  }}
                >
                  Thông tin đề tài
                </strong>
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    fontSize: "14px",
                    color: "hsl(215, 25%, 40%)",
                  }}
                >
                  <li>Đồ án tốt nghiệp Công nghệ Thông tin</li>
                  <li>WebRTC SFU · mediasoup · Socket.IO · React</li>
                  <li>© 2026 CollabSpace Workspace</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="editorial-footer-bottom">
            <span>© 2026 CollabSpace Workspace. Bảo lưu mọi quyền.</span>
            <span>Realtime Collaborative Architecture · Báo cáo Tốt nghiệp CNTT</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
