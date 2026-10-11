import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useApp } from "../../app/providers/AppContext";
import { NexoLogo } from "../../shared/ui/NexoLogo";
import { ambientBridge } from "../../shared/motion/AmbientBackdrop";
import { GSAP_EASE_OUT } from "../../shared/motion/tokens";
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
  },
  {
    id: "chat",
    name: "Kênh thảo luận nhóm",
    location: "Trao đổi tức thời đa kênh",
    specs: "Socket.IO · Chủ đề & nhắc tên · Đính kèm tệp",
    badge: "Tin nhắn realtime",
    desc: "Trò chuyện phân kênh theo nhóm, trả lời theo chủ đề, ghim và đánh dấu tin nhắn; lịch sử được lưu trong PostgreSQL và đồng bộ tức thời tới mọi thành viên.",
  },
  {
    id: "tasks",
    name: "Bảng quản lý công việc",
    location: "Điều phối tiến độ dự án",
    specs: "Kanban · Checklist · Bình luận",
    badge: "Cộng tác nhóm",
    desc: "Theo dõi tiến độ trên bảng Kanban theo kênh, phân công người phụ trách, hạn chót và mức ưu tiên; quyền thao tác theo vai trò trong nhóm.",
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

export function LandingPage() {
  const { openAuth, enterWorkspace, user } = useApp();
  const [isScrolled, setIsScrolled] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const scrollTweenRef = useRef<gsap.core.Tween | null>(null);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 40);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const stopProgrammaticScroll = () => {
      if (scrollTweenRef.current) {
        scrollTweenRef.current.kill();
        scrollTweenRef.current = null;
      }
    };
    window.addEventListener("wheel", stopProgrammaticScroll, { passive: true });
    window.addEventListener("touchstart", stopProgrammaticScroll, { passive: true });
    return () => {
      window.removeEventListener("wheel", stopProgrammaticScroll);
      window.removeEventListener("touchstart", stopProgrammaticScroll);
      stopProgrammaticScroll();
    };
  }, []);

  // GSAP owns the hero entrance, scrubbed parallax, and scroll-triggered staggered text/card reveals.
  useLayoutEffect(() => {
    const shell = shellRef.current;
    const hero = heroRef.current;
    if (!shell || !hero) return;
    const ctx = gsap.context(() => {
      gsap
        .timeline({ defaults: { ease: GSAP_EASE_OUT } })
        .from(".hero-word > span", { yPercent: 110, autoAlpha: 0, duration: 1.05, stagger: 0.065 })
        .from(".editorial-paragraph", { autoAlpha: 0, y: 24, duration: 0.9 }, "-=0.72")
        .from(".hero-cta", { autoAlpha: 0, y: 20, duration: 0.8 }, "-=0.65");

      gsap.to(".editorial-hero", {
        yPercent: -14,
        autoAlpha: 0.25,
        ease: "none",
        scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: 0.6 },
      });

      ScrollTrigger.create({
        trigger: hero,
        start: "top top",
        end: "bottom top",
        onUpdate: (self) => ambientBridge.setScroll(self.progress),
      });

      // Staggered text rise for every section header (tag -> title -> subtitle)
      gsap.utils.toArray<HTMLElement>(".editorial-section-head").forEach((head) => {
        const items = head.querySelectorAll(".editorial-tag, .editorial-title, .editorial-subtitle");
        gsap.fromTo(
          items,
          { autoAlpha: 0, y: 36 },
          {
            autoAlpha: 1,
            y: 0,
            duration: 0.85,
            stagger: 0.12,
            ease: GSAP_EASE_OUT,
            scrollTrigger: {
              trigger: head,
              start: "top 86%",
              toggleActions: "play none none reverse",
            },
          },
        );
      });

      // Staggered rise for residence cards and their inner text
      gsap.fromTo(
        ".editorial-residence-card",
        { autoAlpha: 0, y: 48 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.9,
          stagger: 0.14,
          ease: GSAP_EASE_OUT,
          scrollTrigger: {
            trigger: ".editorial-residences-grid",
            start: "top 84%",
            toggleActions: "play none none reverse",
          },
        },
      );

      // Staggered rise for architecture pillars
      gsap.fromTo(
        ".editorial-arch-item",
        { autoAlpha: 0, y: 44 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.85,
          stagger: 0.14,
          ease: GSAP_EASE_OUT,
          scrollTrigger: {
            trigger: ".editorial-arch-grid",
            start: "top 84%",
            toggleActions: "play none none reverse",
          },
        },
      );

      // Rise for benchmark metrics bar & note
      gsap.fromTo(
        [".editorial-metrics-bar", ".editorial-metrics-note"],
        { autoAlpha: 0, y: 34, scale: 0.98 },
        {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          duration: 0.85,
          stagger: 0.12,
          ease: GSAP_EASE_OUT,
          scrollTrigger: {
            trigger: ".editorial-metrics-bar",
            start: "top 88%",
            toggleActions: "play none none reverse",
          },
        },
      );

      // Staggered rise for philosophy quote box (quote text -> author)
      gsap.fromTo(
        ".editorial-quote-box .editorial-quote-text, .editorial-quote-box .editorial-quote-author",
        { autoAlpha: 0, y: 36 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.9,
          stagger: 0.14,
          ease: GSAP_EASE_OUT,
          scrollTrigger: {
            trigger: ".editorial-quote-box",
            start: "top 85%",
            toggleActions: "play none none reverse",
          },
        },
      );

      // Staggered rise for principle cards
      gsap.fromTo(
        ".editorial-principle-card",
        { autoAlpha: 0, y: 40 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.85,
          stagger: 0.13,
          ease: GSAP_EASE_OUT,
          scrollTrigger: {
            trigger: ".editorial-principles",
            start: "top 85%",
            toggleActions: "play none none reverse",
          },
        },
      );

      // Closing CTA button rise
      gsap.fromTo(
        ".editorial-closing-cta",
        { autoAlpha: 0, y: 30 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.8,
          ease: GSAP_EASE_OUT,
          scrollTrigger: {
            trigger: ".editorial-closing-cta",
            start: "top 90%",
            toggleActions: "play none none reverse",
          },
        },
      );
    }, shell);

    return () => {
      ctx.revert();
      ambientBridge.setScroll(0);
    };
  }, []);

  const smoothScrollTo = (targetY: number) => {
    if (scrollTweenRef.current) {
      scrollTweenRef.current.kill();
      scrollTweenRef.current = null;
    }
    const startY = window.scrollY;
    const clampedTarget = Math.max(
      0,
      Math.min(targetY, document.documentElement.scrollHeight - window.innerHeight),
    );
    const distance = Math.abs(clampedTarget - startY);
    if (distance < 2) return;
    const duration = Math.min(1.35, Math.max(0.75, distance / 1400));
    const state = { y: startY };
    scrollTweenRef.current = gsap.to(state, {
      y: clampedTarget,
      duration,
      ease: "power3.inOut",
      onUpdate: () => {
        window.scrollTo(0, state.y);
        ScrollTrigger.update();
      },
      onComplete: () => {
        scrollTweenRef.current = null;
        ScrollTrigger.update();
      },
    });
  };

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const targetPos = el.getBoundingClientRect().top + window.scrollY - 80;
    smoothScrollTo(targetPos);
  };

  const handleHeroCta = () => (user ? enterWorkspace() : openAuth("register"));
  const handleNavCta = () => (user ? enterWorkspace() : openAuth("login"));

  return (
    <div className="editorial-shell" ref={shellRef}>
      <header className={`editorial-nav-bar ${isScrolled ? "is-scrolled" : ""}`}>
        <nav className="editorial-nav" aria-label="Điều hướng chính">
          <div className="editorial-nav-left">
            <button
              type="button"
              onClick={() => smoothScrollTo(0)}
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
        <div className="editorial-section-head">
          <span className="editorial-tag">Hệ sinh thái cộng tác</span>
          <h2 className="editorial-title">Không gian chuyên biệt</h2>
          <p className="editorial-subtitle">
            Tập trung cao độ với các phân khu chức năng được thiết kế tinh giản, tối ưu hóa trải
            nghiệm tương tác nhóm mà không gây nhiễu loạn thị giác.
          </p>
        </div>

        <div className="editorial-residences-grid">
          {spacesList.map((space) => (
            <article key={space.id} className="editorial-residence-card">
              <div className="editorial-residence-body">
                <h3 className="editorial-residence-name">{space.name}</h3>
                <p className="editorial-residence-desc">{space.desc}</p>
                <div className="editorial-residence-specs">
                  <span>{space.location}</span>
                  <strong>{space.specs}</strong>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="architecture" className="editorial-section editorial-section--warm">
        <div className="editorial-section-inner">
          <div className="editorial-section-head">
            <span className="editorial-tag">Nền tảng kỹ thuật</span>
            <h2 className="editorial-title">Kiến trúc phân tán SFU</h2>
            <p className="editorial-subtitle">
              Sự kết hợp giữa định tuyến WebRTC và kiến trúc phần mềm phân tầng của đồ án tốt
              nghiệp.
            </p>
          </div>

          <div className="editorial-arch-grid">
            {architecturePillars.map((pillar) => (
              <div key={pillar.num} className="editorial-arch-item">
                <span className="editorial-arch-num">{pillar.num}</span>
                <h3 className="editorial-arch-title">{pillar.title}</h3>
                <p className="editorial-arch-desc">{pillar.desc}</p>
              </div>
            ))}
          </div>

          <div className="editorial-metrics-bar">
            {measuredMetrics.map((metric) => (
              <div key={metric.value}>
                <div className="editorial-metric-val">{metric.value}</div>
                <div className="editorial-metric-label">{metric.label}</div>
              </div>
            ))}
          </div>
          <p className="editorial-metrics-note">
            Số liệu đo trên máy chủ cục bộ (Ryzen 7 6800HS, loopback); chưa phản ánh mạng internet
            thực tế.
          </p>
        </div>
      </section>

      <section id="philosophy" className="editorial-section">
        <div className="editorial-quote-box">
          <p className="editorial-quote-text">
            “Sự tinh tế đỉnh cao không nằm ở việc thêm thắt tính năng, mà ở việc loại bỏ triệt để
            mọi tiếng ồn và sự xao nhãng.”
          </p>
          <span className="editorial-quote-author">
            Triết lý thiết kế hệ thống nexo · Đồ án tốt nghiệp
          </span>
        </div>

        <div className="editorial-principles">
          {principles.map((principle) => (
            <div key={principle.tag} className="editorial-principle-card">
              <div className="editorial-principle-tag">{principle.tag}</div>
              <h3 className="editorial-principle-heading">{principle.heading}</h3>
              <p className="editorial-principle-desc">{principle.desc}</p>
            </div>
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
