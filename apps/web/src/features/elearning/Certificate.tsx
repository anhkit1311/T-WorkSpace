import { useEffect, useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import type { CourseCertificate } from "@doan/shared";
import { Button, Modal } from "../../shared/ui/Primitives";
import { TdtuLogo } from "../../shared/ui/TdtuLogo";
import { coursesApi } from "./courses-api";
import "./certificate.css";

const verifyUrl = (code: string) => `${window.location.origin}/verify/${code}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });

/** QR as one SVG path built from the matrix: no innerHTML. */
function QrCode({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    let d = "";
    for (let row = 0; row < count; row++) for (let col = 0; col < count; col++) if (qr.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
    return { size: count, path: d };
  }, [value]);
  return (
    <svg className="certificate__qr" viewBox={`-2 -2 ${size + 4} ${size + 4}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect x={-2} y={-2} width={size + 4} height={size + 4} fill="#fff" />
      <path d={path} fill="#0f172a" />
    </svg>
  );
}

/** EL-8: the certificate itself; printed (or saved as PDF) from the browser so Vietnamese renders exactly. */
export function CertificateCard({ certificate }: { certificate: CourseCertificate }) {
  return (
    <article className="certificate" aria-label={`Chứng nhận ${certificate.code}`}>
      <header className="certificate__head">
        <TdtuLogo height={36} />
        <span>Trường Đại học Tôn Đức Thắng · {certificate.unitName}</span>
      </header>
      <p className="certificate__eyebrow">Chứng nhận hoàn thành khóa học</p>
      <p className="certificate__lead">Chứng nhận</p>
      <h2 className="certificate__name">{certificate.learnerName}</h2>
      <p className="certificate__lead">đã hoàn thành khóa học</p>
      <h3 className="certificate__course">
        {certificate.courseCode} — {certificate.courseTitle}
      </h3>
      <p className="certificate__meta">
        {certificate.lessonCount} bài học · Giảng viên: {certificate.instructors.join(", ")}
      </p>
      <footer className="certificate__foot">
        <div>
          <p>Cấp ngày {day(certificate.issuedAt)}</p>
          <p>
            Mã tra cứu: <strong>{certificate.code}</strong>
          </p>
          <p className="certificate__url">{verifyUrl(certificate.code)}</p>
        </div>
        <QrCode value={verifyUrl(certificate.code)} label={`Mã QR tra cứu chứng nhận ${certificate.code}`} />
      </footer>
    </article>
  );
}

export function CertificateDialog({ token, courseId, onClose }: { token: string; courseId: string; onClose: () => void }) {
  const [certificate, setCertificate] = useState<CourseCertificate | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    coursesApi.certificate(token, courseId).then(setCertificate, (failure) => setError(failure.message));
  }, [token, courseId]);
  return (
    <Modal
      title="Chứng nhận hoàn thành"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>Đóng</Button>
          <Button type="button" icon="download" disabled={!certificate} onClick={() => window.print()}>In / Lưu PDF</Button>
        </>
      }
    >
      {error ? <p role="alert" className="courses-error">{error}</p> : certificate ? <CertificateCard certificate={certificate} /> : <p>Đang cấp chứng nhận…</p>}
    </Modal>
  );
}

/** Public page behind the QR code (no sign-in): confirms the certificate is genuine. */
export function VerifyCertificatePage({ code }: { code: string }) {
  const [state, setState] = useState<{ certificate?: CourseCertificate; error?: string }>({});
  useEffect(() => {
    coursesApi.verify(code).then((certificate) => setState({ certificate }), (failure) => setState({ error: failure.message }));
  }, [code]);
  return (
    <main className="certificate-verify">
      {state.certificate ? (
        <>
          <p className="certificate-verify__ok" role="status">✓ Chứng nhận hợp lệ, do hệ thống e-learning TDTU cấp.</p>
          <CertificateCard certificate={state.certificate} />
        </>
      ) : state.error ? (
        <p className="certificate-verify__bad" role="alert">{state.error}</p>
      ) : (
        <p>Đang tra cứu {code}…</p>
      )}
    </main>
  );
}
