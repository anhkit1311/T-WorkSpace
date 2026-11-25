import { useEffect, useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import type { CourseCertificate } from "@doan/shared";
import { Button, Modal } from "../../shared/ui/Primitives";
import { TdtuLogo } from "../../shared/ui/TdtuLogo";
import { coursesApi } from "./courses-api";
import { Icon } from "../../shared/ui/Icon";
import { cn } from "../../shared/lib/utils";
import "./certificate.css";

const SERIF = "font-['Playfair_Display',Georgia,serif]";

const verifyUrl = (code: string) => `${window.location.origin}/verify/${code}`;
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });

/** QR as one SVG path built from the matrix: no innerHTML. */
function QrCode({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    let d = "";
    for (let row = 0; row < count; row++)
      for (let col = 0; col < count; col++) if (qr.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
    return { size: count, path: d };
  }, [value]);
  return (
    <svg
      className="size-16 shrink-0"
      viewBox={`-2 -2 ${size + 4} ${size + 4}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect x={-2} y={-2} width={size + 4} height={size + 4} fill="#fff" />
      <path d={path} fill="#0f172a" />
    </svg>
  );
}

/** EL-8: the certificate itself; printed (or saved as PDF) from the browser so Vietnamese renders exactly. */
export function CertificateCard({ certificate }: { certificate: CourseCertificate }) {
  return (
    // Always a cream page with dark ink, whatever the app theme (it is printed as is).
    <article
      className="certificate tw relative mx-auto grid w-full max-w-[860px] content-between gap-5 bg-[#fffdf7] px-11 py-9 text-center text-[#1e293b] shadow-[0_12px_40px_rgba(0,0,0,.12)] min-[700px]:aspect-[1.414] max-[699px]:px-6 max-[699px]:py-7 before:pointer-events-none before:absolute before:inset-3 before:border-[1.5px] before:border-[#b08d3c] after:pointer-events-none after:absolute after:inset-[18px] after:border-[0.5px] after:border-[#d8c18a]"
      aria-label={`Chứng nhận ${certificate.code}`}
    >
      <header className="relative flex flex-wrap items-center justify-center gap-3 text-[13px] tracking-[.02em] text-[#475569]">
        <TdtuLogo height={36} className="text-[#002d62]!" />
        <span>Trường Đại học Tôn Đức Thắng · {certificate.unitName}</span>
      </header>
      <div className="relative grid gap-2">
        <p className="text-xs font-semibold tracking-[.32em] text-[#8a6a21]! uppercase">
          Chứng nhận hoàn thành khóa học
        </p>
        <p className={cn(SERIF, "text-base text-[#64748b]! italic")}>Trân trọng chứng nhận</p>
        <h2
          className={cn(
            SERIF,
            "text-[42px]! leading-tight font-bold! text-[#0a2a5e]! max-[699px]:text-[30px]!",
          )}
        >
          {certificate.learnerName}
        </h2>
        <p className={cn(SERIF, "text-base text-[#64748b]! italic")}>đã hoàn thành khóa học</p>
        <h3 className="text-[19px] font-semibold text-[#0f172a]">
          {certificate.courseCode} — {certificate.courseTitle}
        </h3>
        <p className="text-[13px] text-[#64748b]!">
          {certificate.lessonCount} bài học · Giảng viên: {certificate.instructors.join(", ")}
        </p>
      </div>
      <footer className="relative grid grid-cols-[1fr_auto_1fr] items-end gap-4 text-left text-xs text-[#475569] max-[699px]:grid-cols-1 max-[699px]:justify-items-center max-[699px]:text-center">
        <div>
          <p className="text-xs! text-[#475569]!">Cấp ngày {day(certificate.issuedAt)}</p>
          <p className="text-xs! text-[#475569]!">
            Mã tra cứu: <strong className="text-[#0f172a]">{certificate.code}</strong>
          </p>
        </div>
        {/* Decoration only, not the university's real seal. */}
        <span
          className="grid size-[76px] place-items-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#e9c46a,#b08d3c)] text-[10px] font-bold tracking-[.08em] text-white shadow-[inset_0_0_0_4px_rgba(255,255,255,.35)]"
          aria-hidden="true"
        >
          TDTU
        </span>
        <div className="flex items-end justify-end gap-2.5 text-right max-[699px]:justify-center">
          <span>
            Quét để xác thực
            <small className="block text-[11px] break-all text-[#64748b]">
              {verifyUrl(certificate.code)}
            </small>
          </span>
          <QrCode
            value={verifyUrl(certificate.code)}
            label={`Mã QR tra cứu chứng nhận ${certificate.code}`}
          />
        </div>
      </footer>
    </article>
  );
}

export function CertificateDialog({
  token,
  courseId,
  onClose,
}: {
  token: string;
  courseId: string;
  onClose: () => void;
}) {
  const [certificate, setCertificate] = useState<CourseCertificate | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    coursesApi
      .certificate(token, courseId)
      .then(setCertificate, (failure) => setError(failure.message));
  }, [token, courseId]);
  return (
    <Modal
      title="Chứng nhận hoàn thành"
      icon="graduation-cap"
      size="wide"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            Đóng
          </Button>
          <Button
            type="button"
            icon="download"
            disabled={!certificate}
            onClick={() => window.print()}
          >
            In / Lưu PDF
          </Button>
        </>
      }
    >
      <div className="tw bg-secondary p-6 text-sm max-[699px]:p-3">
        {error ? (
          <p
            role="alert"
            className="rounded-md bg-[var(--tint-red-bg)] px-3 py-2 text-[13px] text-[var(--tint-red-fg)]"
          >
            {error}
          </p>
        ) : certificate ? (
          <CertificateCard certificate={certificate} />
        ) : (
          <p className="text-muted-foreground">Đang cấp chứng nhận…</p>
        )}
      </div>
    </Modal>
  );
}

/** Public page behind the QR code (no sign-in): confirms the certificate is genuine. */
export function VerifyCertificatePage({ code }: { code: string }) {
  const [state, setState] = useState<{ certificate?: CourseCertificate; error?: string }>({});
  useEffect(() => {
    coursesApi.verify(code).then(
      (certificate) => setState({ certificate }),
      (failure) => setState({ error: failure.message }),
    );
  }, [code]);
  const certificate = state.certificate;
  return (
    <main className="tw mx-auto grid w-full max-w-[900px] gap-3.5 px-4 py-10 text-sm text-foreground">
      {certificate ? (
        <>
          <div
            className="flex items-center gap-3 rounded-xl bg-[var(--tint-green-bg)] px-4 py-3.5 text-[var(--tint-green-fg)]"
            role="status"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-emerald-600 text-white">
              <Icon name="check" size={18} />
            </span>
            <span>
              <b className="block font-semibold">Chứng nhận hợp lệ</b>
              <small className="text-[13px] opacity-85">
                Do hệ thống e-learning T-WorkSpace của Trường Đại học Tôn Đức Thắng cấp.
              </small>
            </span>
          </div>
          <dl className="grid grid-cols-2 gap-2.5 min-[700px]:grid-cols-4">
            {(
              [
                ["Học viên", certificate.learnerName],
                ["Khóa học", certificate.courseCode],
                ["Ngày cấp", day(certificate.issuedAt)],
                ["Mã tra cứu", certificate.code],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-[10px] border bg-card px-3 py-2.5">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="text-sm font-semibold [overflow-wrap:anywhere]">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="rounded-xl bg-secondary p-6 max-[699px]:p-3">
            <CertificateCard certificate={certificate} />
          </div>
        </>
      ) : state.error ? (
        <p
          className="flex items-center gap-2.5 rounded-xl bg-[var(--tint-red-bg)] px-4 py-3.5 font-semibold text-[var(--tint-red-fg)]"
          role="alert"
        >
          <Icon name="warning" size={18} />
          {state.error}
        </p>
      ) : (
        <p className="text-muted-foreground">Đang tra cứu {code}…</p>
      )}
    </main>
  );
}
