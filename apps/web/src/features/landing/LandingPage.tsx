import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Video, MessageSquare, CheckSquare } from "lucide-react";
import { useApp } from "../../app/providers/AppContext";
import { NexoLogo } from "../../shared/ui/NexoLogo";
import { ambientBridge } from "../../shared/motion/AmbientBackdrop";
import { EASE_OUT, GSAP_EASE_OUT, prefersReducedMotion } from "../../shared/motion/tokens";
import "./editorial.css";

gsap.registerPlugin(ScrollTrigger);

const HERO_TITLE = "Không gian cộng tác thời gian thực";

const spacesList = [
  {
    id: "meetings",
    name: "Phòng họp trực tuyến SFU",
    location: "Hội nghị truyền hình đa điểm",
    specs: "mediasoup SFU · Chia sẻ màn hình · Đo QoS",
    badge: "Truyền thông SFU",
    desc: "Phòng họp thời gian thực định tuyến qua SFU: mỗi người chỉ gửi một luồng lên máy chủ, có chia sẻ màn hình, chat trong cuộc họp và xuất báo cáo chất lượng kết nối.",
    icon: Video,
  },
  {
    id: "chat",
    name: "Kênh thảo luận nhóm",
    location: "Trao đổi tức thời đa kênh",
    specs: "Socket.IO · Chủ đề & nhắc tên · Đính kèm tệp",
    badge: "Tin nhắn realtime",
    desc: "Trò chuyện phân kênh theo nhóm, trả lời theo chủ đề, ghim và đánh dấu tin nhắn; lịch sử được lưu trong PostgreSQL và đồng bộ tức thời tới mọi thành viên.",
    icon: MessageSquare,
  },
  {
    id: "tasks",
    name: "Bảng quản lý công việc",
    location: "Điều phối tiến độ dự án",
    specs: "Kanban · Checklist · Bình luận",
    badge: "Cộng tác nhóm",
    desc: "Theo dõi tiến độ trên bảng Kanban theo kênh, phân công người phụ trách, hạn chót và mức ưu tiên; quyền thao tác theo vai trò trong nhóm.",
    icon: CheckSquare,
  },
];

const architecturePillars = [
  {
    num: "01",
    title: "Lõi định tuyến SFU mediasoup",
    desc: "Máy chủ chọn lọc và chuyển tiếp luồng (Selective Forwarding Unit): client không phải mã hóa lại cho từng người nhận như mô hình mesh, nên phòng họp mở rộng tốt hơn.",
  },
  {
    num: "02",
    title: "Đo chất lượng kết nối (QoS)",
    desc: "Thu thập thông số từ WebRTC Stats API trong cuộc họp: RTT, tỉ lệ mất gói, jitter và bitrate; người dùng có thể xuất báo cáo CSV/JSON.",
  },
  {
    num: "03",
    title: "Kiến trúc monorepo phân tầng",
    desc: "Tách rõ kiểu dữ liệu dùng chung (@doan/shared), dịch vụ API và thời gian thực (@doan/api) và ứng dụng web React (@doan/web).",
  },
];

// Figures from docs/benchmarks/benchmark-report.md (loopback, 18/09/2026), not marketing estimates.
const measuredMetrics = [
  { value: "≈ 8 ms", label: "RTT tin nhắn trung bình với 8 client (đo loopback)" },
  { value: "≤ 5,5 ms", label: "Cấp phát transport SFU cho mỗi lượt vào phòng" },
  { value: "100% WebRTC", label: "Chuẩn mở trên trình duyệt, không cần cài plugin" },
];

const principles = [
  {
    tag: "01 / TỐI GIẢN GIAO DIỆN",
    heading: "Thanh lọc không gian",
    desc: "Loại bỏ những hiệu ứng rối mắt, đặt người dùng vào trung tâm của cuộc thảo luận và công việc.",
  },
  {
    tag: "02 / TƯƠNG TÁC LIỀN MẠCH",
    heading: "Chuyển động tự nhiên",
    desc: "Chuyển trang, mở bảng và gửi tin nhắn phản hồi ngay, chỉ dùng transform và opacity để giữ nhịp 60 khung hình.",
  },
  {
    tag: "03 / BỀN BỈ & BẢO MẬT",
    heading: "Nền tảng vững chắc",
    desc: "Xác thực phiên an toàn, dữ liệu lưu bền vững trong PostgreSQL và phân quyền theo vai trò trong nhóm.",
  },
];

const navSections = [
  { id: "residences", label: "Không gian" },
  { id: "architecture", label: "Kiến trúc" },
  { id: "philosophy", label: "Triết lý" },
];

const reveal = {
  initial: { opacity: 0, y: 32 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.2 },
};

export function LandingPage() {
  const { openAuth, enterWorkspace, user } = useApp();
  const [isScrolled, setIsScrolled] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 40);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // GSAP owns the hero: a masked word reveal, then a scrubbed parallax that also lifts the
  // three.js camera so the landscape and the copy move as one scene.
  useLayoutEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;
    const reduced = prefersReducedMotion();
    const ctx = gsap.context(() => {
      if (!reduced) {
        gsap
          .timeline({ defaults: { ease: GSAP_EASE_OUT } })
          .from(".hero-word > span", { yPercent: 110, duration: 1.1, stagger: 0.07 })
          .from(".editorial-paragraph", { autoAlpha: 0, y: 18, duration: 0.9 }, "-=0.75")
          .from(".hero-cta", { autoAlpha: 0, y: 14, duration: 0.8 }, "-=0.65");
        gsap.to(".editorial-hero", {
          yPercent: -14,
          autoAlpha: 0.25,
          ease: "none",
          scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: 0.6 },
        });
      }
      ScrollTrigger.create({
        trigger: hero,
        start: "top top",
        end: "bottom top",
        onUpdate: (self) => ambientBridge.setScroll(self.progress),
      });
    }, hero);
    return () => {
      ctx.revert();
      ambientBridge.setScroll(0);
    };
  }, []);

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const targetPos = el.getBoundingClientRect().top + window.scrollY - 80;
    window.scrollTo({ top: targetPos, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  };

  const handleHeroCta = () => (user ? enterWorkspace() : openAuth("register"));
  const handleNavCta = () => (user ? enterWorkspace() : openAuth("login"));

  return (
    <div className="editorial-shell">
      <header className={`editorial-nav-bar ${isScrolled ? "is-scrolled" : ""}`}>
        <nav className="editorial-nav" aria-label="Điều hướng chính">
          <div className="editorial-nav-left">
            <button
              type="button"
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="editorial-brand"
            >
              <NexoLogo />
            </button>
          </div>

          <div className="editorial-nav-center">
            {navSections.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => scrollToSection(section.id)}
                className="editorial-nav-link"
              >
                {section.label}
              </button>
            ))}
          </div>

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

      <div className="editorial-hero-wrapper" ref={heroRef}>
        <main className="editorial-hero">
          <h1 className="editorial-heading" aria-label={HERO_TITLE}>
            {HERO_TITLE.split(" ").map((word, index) => (
              <span className="hero-word" key={`${word}-${index}`} aria-hidden="true">
                <span>{word}</span>
              </span>
            ))}
          </h1>

          <p className="editorial-paragraph">
            Nền tảng làm việc nhóm tích hợp trao đổi tức thời và hội nghị truyền hình WebRTC SFU độ
            trễ thấp. Nơi mọi kết nối hội tụ liền mạch, tĩnh tại và bảo mật.
          </p>

          <div className="hero-cta">
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

      <section id="residences" className="editorial-section">
        <motion.div
          className="editorial-section-head"
          {...reveal}
          transition={{ duration: 0.8, ease: EASE_OUT }}
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
              <motion.article
                key={space.id}
                className="editorial-residence-card"
                initial={{ opacity: 0, y: 36 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.15 }}
                transition={{ duration: 0.75, delay: idx * 0.12, ease: EASE_OUT }}
              >
                <div className="editorial-residence-media">
                  <div className={`editorial-residence-img editorial-residence-img--${space.id}`}>
                    <IconComponent aria-hidden="true" />
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
              </motion.article>
            );
          })}
        </div>
      </section>

      <section id="architecture" className="editorial-section editorial-section--warm">
        <div className="editorial-section-inner">
          <motion.div
            className="editorial-section-head"
            {...reveal}
            transition={{ duration: 0.8, ease: EASE_OUT }}
          >
            <span className="editorial-tag">Nền tảng kỹ thuật</span>
            <h2 className="editorial-title">Kiến trúc phân tán SFU</h2>
            <p className="editorial-subtitle">
              Sự kết hợp giữa định tuyến WebRTC và kiến trúc phần mềm phân tầng của đồ án tốt
              nghiệp.
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
                transition={{ duration: 0.75, delay: idx * 0.12, ease: EASE_OUT }}
              >
                <span className="editorial-arch-num">{pillar.num}</span>
                <h3 className="editorial-arch-title">{pillar.title}</h3>
                <p className="editorial-arch-desc">{pillar.desc}</p>
              </motion.div>
            ))}
          </div>

          <motion.div
            className="editorial-metrics-bar"
            initial={{ opacity: 0, scale: 0.98 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: 0.8, ease: EASE_OUT }}
          >
            {measuredMetrics.map((metric) => (
              <div key={metric.value}>
                <div className="editorial-metric-val">{metric.value}</div>
                <div className="editorial-metric-label">{metric.label}</div>
              </div>
            ))}
          </motion.div>
          <p className="editorial-metrics-note">
            Số liệu đo trên máy chủ cục bộ (Ryzen 7 6800HS, loopback); chưa phản ánh mạng internet
            thực tế.
          </p>
        </div>
      </section>

      <section id="philosophy" className="editorial-section">
        <motion.div
          className="editorial-quote-box"
          {...reveal}
          transition={{ duration: 0.85, ease: EASE_OUT }}
        >
          <p className="editorial-quote-text">
            “Sự tinh tế đỉnh cao không nằm ở việc thêm thắt tính năng, mà ở việc loại bỏ triệt để
            mọi tiếng ồn và sự xao nhãng.”
          </p>
          <span className="editorial-quote-author">
            Triết lý thiết kế hệ thống nexo · Đồ án tốt nghiệp
          </span>
        </motion.div>

        <div className="editorial-principles">
          {principles.map((principle, idx) => (
            <motion.div
              key={principle.tag}
              className="editorial-principle-card"
              initial={{ opacity: 0, y: 28 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.7, delay: 0.1 + idx * 0.1, ease: EASE_OUT }}
            >
              <div className="editorial-principle-tag">{principle.tag}</div>
              <h3 className="editorial-principle-heading">{principle.heading}</h3>
              <p className="editorial-principle-desc">{principle.desc}</p>
            </motion.div>
          ))}
        </div>

        <div className="editorial-closing-cta">
          <button
            type="button"
            onClick={handleHeroCta}
            className="editorial-pill-btn editorial-pill-btn--lg"
          >
            {user ? "Vào không gian làm việc" : "Trải nghiệm hệ thống ngay"}
          </button>
        </div>
      </section>

      <footer className="editorial-footer">
        <div className="editorial-footer-inner">
          <div className="editorial-footer-top">
            <div className="editorial-footer-brand-block">
              <span className="editorial-brand editorial-footer-brand">
                <NexoLogo />
              </span>
              <p className="editorial-footer-lead">
                Không gian làm việc cộng tác thời gian thực và hội nghị truyền hình WebRTC SFU.
              </p>
            </div>

            <div className="editorial-footer-columns">
              <div>
                <strong className="editorial-footer-heading">Điều hướng</strong>
                <ul className="editorial-footer-list">
                  {navSections.map((section) => (
                    <li key={section.id}>
                      <button
                        type="button"
                        onClick={() => scrollToSection(section.id)}
                        className="editorial-nav-link"
                      >
                        {section.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <strong className="editorial-footer-heading">Thông tin đề tài</strong>
                <ul className="editorial-footer-list editorial-footer-list--muted">
                  <li>Đồ án tốt nghiệp Công nghệ Thông tin</li>
                  <li>WebRTC SFU · mediasoup · Socket.IO · React</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="editorial-footer-bottom">
            <span>© 2026 nexo Workspace.</span>
            <span>Realtime Collaborative Architecture · Báo cáo tốt nghiệp CNTT</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
