import { useEffect, useRef, useState, type MouseEvent } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useApp } from "../../app/providers/AppContext";
import { Badge, Brand, Button, IconButton } from "../../shared/ui/Primitives";
import { Icon, type IconName } from "../../shared/ui/Icon";

const features: Array<{ icon: IconName; title: string; text: string; accent: string }> = [
  {
    icon: "message",
    title: "Trao đổi thời gian thực",
    text: "Kênh thảo luận nhóm đồng bộ theo thời gian thực qua Socket.IO.",
    accent: "blue",
  },
  {
    icon: "video",
    title: "Hội nghị truyền hình SFU",
    text: "Phòng họp WebRTC qua mediasoup SFU, với micro, camera và chia sẻ màn hình.",
    accent: "violet",
  },
  {
    icon: "sparkles",
    title: "Đo kiểm chất lượng mạng QoS",
    text: "Theo dõi độ trễ, băng thông và tỷ lệ mất gói; xuất dữ liệu QoS khi tham gia họp.",
    accent: "cyan",
  },
  {
    icon: "admin",
    title: "Phân quyền Quản trị nhóm",
    text: "Người tạo nhóm là Chủ nhóm (Owner) với quyền quản lý thành viên.",
    accent: "amber",
  },
];

const faqs = [
  [
    "CollabSpace có phù hợp cho doanh nghiệp lớn không?",
    "Đây là bản MVP phục vụ đồ án. Hệ thống có phân quyền nhóm; SSO và mở rộng doanh nghiệp nằm ngoài phạm vi hiện tại.",
  ],
  [
    "Tôi có thể mời khách bên ngoài vào cuộc họp không?",
    "Người tham gia cần đăng nhập và được cấp quyền thành viên trong nhóm.",
  ],
  [
    "Dữ liệu cuộc họp được lưu ở đâu?",
    "Lịch sử tham gia được lưu trong PostgreSQL. Hệ thống chưa hỗ trợ lưu bản ghi âm thanh hoặc video.",
  ],
];

export function LandingPage() {
  const { openAuth, enterWorkspace } = useApp();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);
  const cancelScroll = useRef<() => void>(() => {});
  const reduceMotion = useReducedMotion();
  const heroRef = useRef<HTMLElement>(null);
  const platformRef = useRef<HTMLElement>(null);
  const { scrollYProgress: platformProgress } = useScroll({ target: platformRef, offset: ["start end", "end start"] });
  const platformDepth = useTransform(platformProgress, [0, 1], [26, -26]);

  useEffect(() => () => cancelScroll.current(), []);

  const handleAnchorClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLAnchorElement>('a[href^="#"]');
    if (!link) return;
    const id = link.hash.slice(1);
    const target = document.getElementById(id);
    if (!target) return;

    event.preventDefault();
    cancelScroll.current();
    history.pushState(null, "", link.hash);

    const startY = window.scrollY;
    const offset = id === "top" ? 0 : (document.querySelector(".landing-nav")?.getBoundingClientRect().height ?? 66) + 12;
    const maxY = document.documentElement.scrollHeight - window.innerHeight;
    const endY = Math.max(0, Math.min(target.getBoundingClientRect().top + startY - offset, maxY));
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      window.scrollTo({ top: endY, behavior: "instant" });
      return;
    }
    const duration = Math.min(850, Math.max(500, Math.abs(endY - startY) * 0.35));
    const startTime = performance.now();
    let frame = 0;

    const stop = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
    };
    cancelScroll.current = stop;
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchstart", stop, { passive: true });

    const step = (now: number) => {
      const progress = Math.min(1, (now - startTime) / duration);
      const eased = progress < 0.5
        ? 4 * progress ** 3
        : 1 - (-2 * progress + 2) ** 3 / 2;
      window.scrollTo({ top: startY + (endY - startY) * eased, behavior: "instant" });
      if (progress < 1) frame = requestAnimationFrame(step);
      else stop();
    };
    frame = requestAnimationFrame(step);
  };

  const revealSection = (delay = 0) => ({
    initial: { opacity: 0, y: reduceMotion ? 0 : 24 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, amount: 0.16 },
    transition: {
      duration: 0.72,
      delay,
      ease: [0.16, 1, 0.3, 1] as const,
    },
  });

  return (
    <div className="landing" id="top" onClickCapture={handleAnchorClick}>
      <header className="landing-nav">
        <div className="landing-container landing-nav__inner">
          <a className="brand-button" href="#top">
            <Brand />
          </a>
          <nav
            className={`landing-links ${mobileOpen ? "is-open" : ""}`}
            aria-label="Điều hướng chính"
          >
            <a href="#features" onClick={() => setMobileOpen(false)}>Giải pháp</a>
            <a href="#platform" onClick={() => setMobileOpen(false)}>Nền tảng</a>
            <a href="#mvp" onClick={() => setMobileOpen(false)}>Phạm vi MVP</a>
            <a href="#security" onClick={() => setMobileOpen(false)}>Bảo mật</a>
          </nav>
          <div className="landing-actions">
            <Button variant="ghost" className="hide-mobile" onClick={() => openAuth("login")}>
              Đăng nhập
            </Button>
            <Button size="sm" onClick={() => openAuth("register")}>
              Bắt đầu miễn phí
            </Button>
            <IconButton
              label={mobileOpen ? "Đóng menu" : "Mở menu"}
              icon={mobileOpen ? "x" : "menu"}
              className="mobile-menu-button"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(!mobileOpen)}
            />
          </div>
        </div>
      </header>

      <main id="main-content">
        <section className="hero" ref={heroRef}>
          <div className="hero-atmosphere" aria-hidden="true" />
          <div className="landing-container hero__inner">
            <div className="hero__copy reveal">
              <h1>
                Một quỹ đạo.
                <br />
                <span>Mọi kết nối.</span>
              </h1>
              <p>
                Kết nối đội ngũ, kênh trò chuyện và cuộc họp video trong một workspace thời gian
                thực — tối giản, trực quan và liền mạch.
              </p>
              <div className="hero__actions">
                <Button size="lg" icon="arrow-right" onClick={() => openAuth("register")}>
                  Bắt đầu miễn phí
                </Button>
                <Button size="lg" variant="secondary" icon="play" onClick={enterWorkspace}>
                  Đăng nhập vào workspace
                </Button>
              </div>
              <div className="hero__trust">
                <span>
                  <Icon name="check" size={14} /> Không cần thẻ tín dụng
                </span>
                <span>
                  <Icon name="check" size={14} /> Tạo nhóm và mời thành viên
                </span>
                <span>
                  <Icon name="check" size={14} /> Phiên bản đồ án tốt nghiệp
                </span>
              </div>
            </div>
            <div className="hero__signal" aria-hidden="true">
              <span className="hero__signal-line" />
              <span>NHÓM LÀM VIỆC</span>
              <strong>Một điểm kết nối. Mọi tương tác.</strong>
              <span className="hero__signal-meta">Tin nhắn · Họp video · Thành viên</span>
            </div>
          </div>
        </section>

        <motion.section className="section" id="features" {...revealSection()}>
          <div className="landing-container">
            <div className="section-heading">
              <Badge tone="blue">MỘT NỀN TẢNG DUY NHẤT</Badge>
              <h2>
                Mọi công cụ đội ngũ cần.
                <br />
                <span>Không còn chuyển đổi ngữ cảnh.</span>
              </h2>
              <p>
                CollabSpace hợp nhất cộng tác nội bộ và tương tác thời gian thực mà vẫn giữ trải
                nghiệm phẳng, tinh tế và dễ làm quen.
              </p>
            </div>
            <div className="feature-grid">
              {features.map((feature, index) => (
                <motion.article
                  className="feature-card"
                  key={feature.title}
                  initial={{ opacity: 0, y: reduceMotion ? 0 : 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  whileHover={{ y: reduceMotion ? 0 : -5 }}
                  viewport={{ once: true, amount: 0.2 }}
                  transition={{ duration: 0.48, delay: index * 0.075, ease: [0.16, 1, 0.3, 1] }}
                >
                  <span className="feature-icon">
                    <Icon name={feature.icon} />
                  </span>
                  <h3>{feature.title}</h3>
                  <p>{feature.text}</p>
                  <button onClick={() => openAuth("login")}>
                    Khám phá <Icon name="arrow-right" size={14} />
                  </button>
                </motion.article>
              ))}
            </div>
          </div>
        </motion.section>

        <motion.section className="section platform-section" id="platform" ref={platformRef} {...revealSection(0.04)}>
          <div className="landing-container split-section">
            <motion.div className="split-visual meeting-showcase" style={{ y: reduceMotion ? 0 : platformDepth }}>
              <div className="showcase-header">
                <div>
                  <Icon name="video" size={16} /> Phòng họp nhóm
                </div>
                <Badge tone="blue">Tính năng hiện có</Badge>
              </div>
              <div className="showcase-grid">
                <div className="showcase-person">
                  <span>
                    <Icon name="camera" size={20} />
                  </span>
                  <small>Camera</small>
                </div>
                <div className="showcase-person">
                  <span>
                    <Icon name="mic" size={20} />
                  </span>
                  <small>Âm thanh</small>
                </div>
                <div className="showcase-person">
                  <span>
                    <Icon name="share" size={20} />
                  </span>
                  <small>Chia sẻ màn hình</small>
                </div>
                <div className="showcase-person">
                  <span>
                    <Icon name="zap" size={20} />
                  </span>
                  <small>Chất lượng kết nối</small>
                </div>
              </div>
            </motion.div>
            <div className="split-copy">
              <span className="eyebrow">HỌP VIDEO</span>
              <h2>Khoảng cách biến mất khi mọi người cùng hiện diện.</h2>
              <p>Micro, camera và chia sẻ màn hình trong cùng phòng họp của nhóm.</p>
              <ul>
                <li>
                  <Icon name="check" /> Chia sẻ màn hình trong cuộc họp
                </li>
                <li>
                  <Icon name="check" /> Xuất dữ liệu đo kiểm QoS dạng CSV và JSON
                </li>
                <li>
                  <Icon name="check" /> Truy cập bằng trình duyệt có hỗ trợ WebRTC
                </li>
              </ul>
              <Button variant="secondary" icon="arrow-right" onClick={enterWorkspace}>
                Đăng nhập để họp
              </Button>
            </div>
          </div>
        </motion.section>

        <motion.section className="section trust-section" id="security" {...revealSection(0.04)}>
          <div className="landing-container">
            <div className="security-card">
              <span className="security-icon">
                <Icon name="admin" size={28} />
              </span>
              <div>
                <span className="eyebrow">XÁC THỰC VÀ PHÂN QUYỀN</span>
                <h2>Dữ liệu của bạn luôn thuộc về bạn.</h2>
                <p>
                  Mật khẩu được băm, phiên đăng nhập dùng cookie HttpOnly và quyền truy cập được
                  kiểm tra theo từng nhóm.
                </p>
              </div>
              <div className="security-tags">
                <Badge tone="green">JWT</Badge>
                <Badge tone="blue">HttpOnly</Badge>
                <Badge tone="violet">RBAC</Badge>
              </div>
            </div>
          </div>
        </motion.section>

        <motion.section className="section faq-section" {...revealSection(0.04)}>
          <div className="landing-container faq-layout">
            <div>
              <span className="eyebrow">CÂU HỎI THƯỜNG GẶP</span>
              <h2>Mọi điều bạn cần biết.</h2>
              <p>Đây là phiên bản MVP của đồ án; các tính năng được mô tả theo phạm vi hiện tại.</p>
            </div>
            <div className="faq-list">
              {faqs.map(([question, answer], index) => (
                <article className={openFaq === index ? "is-open" : ""} key={question}>
                  <button
                    aria-expanded={openFaq === index}
                    onClick={() => setOpenFaq(openFaq === index ? -1 : index)}
                  >
                    <span>{question}</span>
                    <Icon name={openFaq === index ? "minus" : "plus"} />
                  </button>
                  {openFaq === index && <p>{answer}</p>}
                </article>
              ))}
            </div>
          </div>
        </motion.section>

        <motion.section className="final-cta" id="mvp" {...revealSection(0.04)}>
          <div className="landing-container">
            <div>
              <Badge tone="blue">TRẢI NGHIỆM BẢN MVP</Badge>
              <h2>Sẵn sàng để đội ngũ làm việc liền mạch hơn?</h2>
              <p>Tạo tài khoản và bắt đầu nhóm làm việc đầu tiên của bạn.</p>
            </div>
            <Button size="lg" icon="arrow-right" onClick={() => openAuth("register")}>
              Bắt đầu miễn phí
            </Button>
          </div>
        </motion.section>
      </main>

      <footer className="landing-footer">
        <div className="landing-container">
          <div className="footer-main">
            <div>
              <Brand />
              <p>Nơi đội ngũ kết nối, cộng tác và tạo ra kết quả tốt hơn — cùng nhau.</p>
            </div>
            <div>
              <strong>Sản phẩm</strong>
              <a href="#features">Tin nhắn</a>
              <a href="#platform">Họp video</a>
              <a href="#security">Bảo mật</a>
            </div>
            <div>
              <strong>Bắt đầu</strong>
              <button type="button" onClick={() => openAuth("login")}>
                Đăng nhập
              </button>
              <button type="button" onClick={() => openAuth("register")}>
                Tạo tài khoản
              </button>
            </div>
          </div>
          <div className="footer-bottom">
            <span>© 2026 CollabSpace. All rights reserved.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
