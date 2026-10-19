import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import type { CourseSummary } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { Badge, Button, Field, Modal } from "../../shared/ui/Primitives";
import { Icon } from "../../shared/ui/Icon";
import { coursesApi } from "./courses-api";
import { CourseView } from "./CourseView";
import "./courses.css";

/** A stable hue per course code, so each card keeps its colour without stored artwork. */
const hueOf = (code: string) => [...code].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 360, 7);

type Filter = "all" | "learning" | "managing";
const FILTERS: [Filter, string][] = [
  ["all", "Tất cả"],
  ["learning", "Đang học"],
  ["managing", "Tôi phụ trách"],
];
export const STATUS_LABEL = { draft: "Nháp", published: "Đã xuất bản", archived: "Lưu trữ" } as const;

/** EL-1..EL-6: course catalogue; opening a course shows its outline, lessons and (for staff) admin. */
export function CoursesWorkspace() {
  const { accessToken, notify, route } = useApp();
  const [courses, setCourses] = useState<CourseSummary[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  // ?q=<courseId> opens a course directly (from the call center's required-training banner).
  const [openId, setOpenId] = useState<string | null>(/^[0-9a-f-]{36}$/i.test(route.query ?? "") ? route.query! : null);
  const [units, setUnits] = useState<{ id: string; code: string; name: string }[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      setCourses(await coursesApi.list(accessToken));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Không tải được khóa học.");
    }
  }, [accessToken]);

  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (accessToken) void coursesApi.units(accessToken).then(setUnits, () => setUnits([]));
  }, [accessToken]);

  if (openId)
    return (
      <CourseView
        courseId={openId}
        onBack={() => {
          setOpenId(null);
          void load();
        }}
      />
    );

  const visible = (courses ?? []).filter((course) =>
    filter === "learning" ? course.enrolled : filter === "managing" ? course.canManage : true,
  );

  return (
    <div className="courses">
      <header className="courses-head">
        <div>
          <h1>Khóa học</h1>
          <p>Học trực tuyến của TDTU: bài video, tài liệu, bài kiểm tra và lớp học trực tuyến.</p>
        </div>
        {units.length > 0 && (
          <Button icon="plus" onClick={() => setCreating(true)}>
            Tạo khóa học
          </Button>
        )}
      </header>
      <div className="courses-filters" role="tablist" aria-label="Lọc khóa học">
        {FILTERS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={filter === id} className={filter === id ? "is-active" : ""} onClick={() => setFilter(id)}>
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="courses-error">
          {error}{" "}
          {!courses && (
            <Button size="sm" variant="ghost" icon="refresh" onClick={() => { setError(""); void load(); }}>
              Thử lại
            </Button>
          )}
        </p>
      )}
      {!courses && !error && <p role="status">Đang tải khóa học…</p>}
      {courses && !visible.length && (
        <div className="courses-empty">
          <Icon name="graduation-cap" size={28} />
          <p>{filter === "learning" ? "Bạn chưa ghi danh khóa học nào." : filter === "managing" ? "Bạn chưa phụ trách khóa học nào." : "Chưa có khóa học nào được xuất bản."}</p>
        </div>
      )}
      <ul className="courses-grid">
        {visible.map((course) => (
          <li key={course.id}>
            <button type="button" className="course-card" onClick={() => setOpenId(course.id)}>
              <span className="course-card__cover" style={{ "--course-hue": hueOf(course.code) } as CSSProperties} aria-hidden="true">
                <Icon name="graduation-cap" size={22} />
              </span>
              <span className="course-card__code">{course.code}</span>
              <strong>{course.title}</strong>
              <span className="course-card__meta">
                {course.unitName} · {course.ownerName}
              </span>
              <span className="course-card__meta">
                {course.lessonCount} bài học{course.canManage ? ` · ${course.learnerCount} học viên` : ""}
              </span>
              <span className="course-card__badges">
                {course.canManage && <Badge tone={course.status === "published" ? "green" : "amber"}>{STATUS_LABEL[course.status]}</Badge>}
                {course.enrolled && (course.progress === 100 ? <Badge tone="green">Đã hoàn thành</Badge> : <Badge tone="blue">Đang học</Badge>)}
                {course.enrollment === "assigned" && <Badge>Theo chỉ định</Badge>}
              </span>
              {course.progress !== null && (
                <span className="course-card__progress">
                  <span className="course-progress" aria-hidden="true">
                    <span style={{ width: `${course.progress}%` }} />
                  </span>
                  <small>Hoàn thành {course.progress}%</small>
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {creating && (
        <CreateCourse
          units={units}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            notify("Đã tạo khóa học");
            setOpenId(id);
          }}
        />
      )}
    </div>
  );
}

function CreateCourse({ units, onClose, onCreated }: { units: { id: string; code: string; name: string }[]; onClose: () => void; onCreated: (id: string) => void }) {
  const { accessToken } = useApp();
  const [unitId, setUnitId] = useState(units[0]?.id ?? "");
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [enrollment, setEnrollment] = useState<"open" | "assigned">("open");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;
    setBusy(true);
    setError("");
    try {
      onCreated((await coursesApi.create(accessToken, { unitId, code: code.trim().toUpperCase(), title: title.trim(), description: description.trim(), enrollment })).id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Không tạo được khóa học.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Tạo khóa học"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Hủy</Button>
          <Button type="submit" form="create-course" disabled={busy}>Tạo</Button>
        </>
      }
    >
      <form id="create-course" className="courses-form" onSubmit={(event) => void submit(event)}>
        <Field label="Đơn vị phụ trách">
          <select value={unitId} onChange={(event) => setUnitId(event.target.value)} required>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>{unit.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Mã khóa học" hint="2–20 ký tự in hoa, số, - hoặc _, ví dụ CC-101">
          <input value={code} onChange={(event) => setCode(event.target.value)} required pattern="[A-Za-z0-9_-]{2,20}" />
        </Field>
        <Field label="Tên khóa học">
          <input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={160} />
        </Field>
        <Field label="Mô tả">
          <textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={4000} />
        </Field>
        <Field label="Ghi danh">
          <select value={enrollment} onChange={(event) => setEnrollment(event.target.value as "open" | "assigned")}>
            <option value="open">Mở: học viên tự đăng ký</option>
            <option value="assigned">Chỉ định: giảng viên gán học viên</option>
          </select>
        </Field>
        {error && <p role="alert" className="courses-error">{error}</p>}
      </form>
    </Modal>
  );
}
