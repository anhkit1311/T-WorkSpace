import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import type { CourseEnrollmentMode, CourseSummary } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { Button, Field, Modal } from "../../shared/ui/Primitives";
import { cn } from "../../shared/lib/utils";
import { Icon } from "../../shared/ui/Icon";
import { coursesApi } from "./courses-api";
import { CourseView } from "./CourseView";
import "./courses.css";

/** A stable hue per course code, so each card keeps its colour without stored artwork. */
const hueOf = (code: string) =>
  [...code].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 360, 7);

/** The card's cover: a gradient from the course's hue, since courses have no artwork. */
const coverOf = (code: string): CSSProperties => {
  const hue = hueOf(code);
  return {
    background: `linear-gradient(135deg, hsl(${hue} 70% 92%), hsl(${(hue + 40) % 360} 70% 84%))`,
    color: `hsl(${hue} 55% 32%)`,
  };
};
const BTN_PRIMARY =
  "inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-primary px-3.5 text-[13.5px] font-semibold whitespace-nowrap text-primary-foreground transition-colors hover:bg-primary/90";
const CARD =
  "cursor-pointer rounded-[10px] border bg-card text-foreground transition hover:border-primary hover:shadow-[0_4px_12px_rgba(15,23,42,0.06)] motion-safe:hover:-translate-y-px";
const CHIP = "rounded-[5px] px-[7px] py-[3px] text-xs leading-none font-semibold whitespace-nowrap";
const GREEN = "bg-[var(--tint-green-bg)] text-[var(--tint-green-fg)]";
const AMBER = "bg-[var(--tint-amber-bg)] text-[var(--tint-amber-fg)]";

type Filter = "all" | "learning" | "managing";
const MATCH: Record<Filter, (course: CourseSummary) => boolean> = {
  all: () => true,
  learning: (course) => course.enrolled,
  managing: (course) => course.canManage,
};
const FILTERS: [Filter, string][] = [
  ["all", "Tất cả"],
  ["learning", "Đang học"],
  ["managing", "Tôi phụ trách"],
];
export const STATUS_LABEL = {
  draft: "Nháp",
  published: "Đã xuất bản",
  archived: "Lưu trữ",
} as const;

/** EL-1..EL-6: course catalogue; opening a course shows its outline, lessons and (for staff) admin. */
export function CoursesWorkspace() {
  const { accessToken, notify, route } = useApp();
  const [courses, setCourses] = useState<CourseSummary[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  // ?q=<courseId> opens a course directly (from the call center's required-training banner).
  const [openId, setOpenId] = useState<string | null>(
    /^[0-9a-f-]{36}$/i.test(route.query ?? "") ? route.query! : null,
  );
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

  const needle = query.trim().toLowerCase();
  const visible = (courses ?? [])
    .filter(MATCH[filter])
    .filter(
      (course) =>
        !needle ||
        course.title.toLowerCase().includes(needle) ||
        course.code.toLowerCase().includes(needle),
    );

  const resume = (courses ?? []).filter(
    (course) => course.enrolled && course.progress !== null && course.progress < 100,
  );
  const chips = (course: CourseSummary) => (
    <span className="flex flex-wrap gap-1">
      {course.canManage && (
        <span className={cn(CHIP, course.status === "published" ? GREEN : AMBER)}>
          {STATUS_LABEL[course.status]}
        </span>
      )}
      {course.enrolled &&
        (course.progress === 100 ? (
          <span className={cn(CHIP, GREEN)}>Đã hoàn thành</span>
        ) : (
          <span className={cn(CHIP, "bg-[var(--tint-blue-bg)] text-[var(--tint-blue-fg)]")}>
            Đang học
          </span>
        ))}
      {course.enrollment === "assigned" && (
        <span className={cn(CHIP, "bg-secondary text-muted-foreground")}>Theo chỉ định</span>
      )}
      {course.enrollment === "approval" && (
        <span className={cn(CHIP, "bg-secondary text-muted-foreground")}>
          {course.requested ? "Chờ duyệt" : "Cần duyệt"}
        </span>
      )}
    </span>
  );
  const progressBar = (value: number) => (
    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
      <span className="block h-full rounded-full bg-primary" style={{ width: `${value}%` }} />
    </span>
  );

  return (
    <div className="tw grid w-full gap-4 px-7 pt-5 pb-10 text-foreground max-md:px-3.5">
      <header className="flex flex-wrap items-center gap-2.5">
        <h1 className="m-0 mr-auto text-[22px] leading-8 font-bold tracking-normal text-foreground">
          Khóa học
        </h1>
        {units.length > 0 && (
          <button type="button" className={BTN_PRIMARY} onClick={() => setCreating(true)}>
            <Icon name="plus" size={17} />
            Tạo khóa học
          </button>
        )}
      </header>

      {error && (
        <p
          role="alert"
          className="flex items-center gap-2.5 rounded-md bg-red-50 px-3 py-2 text-[13px] text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          <span className="flex-1">{error}</span>
          {!courses && (
            <button
              type="button"
              className="cursor-pointer font-semibold underline"
              onClick={() => {
                setError("");
                void load();
              }}
            >
              Thử lại
            </button>
          )}
        </p>
      )}
      {!courses && !error && (
        <p role="status" className="text-[13px] text-muted-foreground">
          Đang tải khóa học…
        </p>
      )}

      {resume.length > 0 && (
        <section className="grid gap-2.5" aria-labelledby="courses-resume">
          <h2
            id="courses-resume"
            className="m-0 text-[15px] leading-5 font-semibold tracking-normal text-foreground"
          >
            Tiếp tục học
          </h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-3 max-md:grid-cols-1">
            {resume.map((course) => (
              <button
                key={course.id}
                type="button"
                className={cn(CARD, "flex items-center gap-3.5 p-3 text-left")}
                onClick={() => setOpenId(course.id)}
              >
                <span
                  className="grid aspect-[16/10] w-28 shrink-0 place-items-center rounded-lg"
                  style={coverOf(course.code)}
                  aria-hidden="true"
                >
                  <Icon name="play" size={22} />
                </span>
                <span className="grid min-w-0 flex-1 gap-1">
                  <small className="text-xs text-muted-foreground">
                    {course.code} · {course.lessonCount} bài học
                  </small>
                  <b className="truncate text-sm font-semibold">{course.title}</b>
                  <span className="flex items-center gap-2">
                    {progressBar(course.progress ?? 0)}
                    <small className="text-xs text-muted-foreground">{course.progress}%</small>
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-1 border-b">
        <div className="flex" role="tablist" aria-label="Lọc khóa học">
          {/* Learners never manage a course: "Tôi phụ trách" is only for staff who can. */}
          {FILTERS.filter(
            ([id]) =>
              id !== "managing" || units.length > 0 || courses?.some((course) => course.canManage),
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={filter === id}
              className={cn(
                "-mb-px cursor-pointer border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap",
                filter === id
                  ? "border-foreground font-semibold text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setFilter(id)}
            >
              {label}
              <small className="ml-1 text-xs font-normal text-muted-foreground">
                {(courses ?? []).filter(MATCH[id]).length}
              </small>
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <label className="mb-1 flex h-[34px] w-[300px] items-center gap-2 rounded-full bg-secondary px-3 text-muted-foreground max-md:w-full">
          <Icon name="search" size={15} />
          <input
            type="search"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground !outline-none placeholder:text-muted-foreground"
            placeholder="Tìm khóa học"
            aria-label="Tìm khóa học"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      {courses && !visible.length && (
        <div className="grid justify-items-center gap-3 py-10 text-center text-sm text-muted-foreground">
          <Icon name="graduation-cap" size={28} />
          <span>
            {query.trim()
              ? "Không tìm thấy khóa học phù hợp."
              : filter === "learning"
                ? "Bạn chưa ghi danh khóa học nào."
                : filter === "managing"
                  ? "Bạn chưa phụ trách khóa học nào."
                  : "Chưa có khóa học nào được xuất bản."}
          </span>
        </div>
      )}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3.5">
        {visible.map((course) => (
          <li key={course.id} className="flex">
            <button
              type="button"
              className={cn(CARD, "flex w-full flex-col overflow-hidden text-left")}
              onClick={() => setOpenId(course.id)}
            >
              <span
                className="flex h-12 w-full items-center px-3.5"
                style={coverOf(course.code)}
                aria-hidden="true"
              >
                <Icon name="graduation-cap" size={18} />
              </span>
              <span className="grid flex-1 content-start gap-1.5 px-3.5 pt-3 pb-3.5">
                <small className="text-xs font-semibold text-foreground">{course.code}</small>
                <strong className="text-[15px] leading-snug font-semibold">{course.title}</strong>
                <span className="text-[13px] text-muted-foreground">
                  {course.unitName} · {course.ownerName}
                </span>
                <span className="text-[13px] text-muted-foreground">
                  {course.lessonCount} bài học
                  {course.canManage ? ` · ${course.learnerCount} học viên` : ""}
                </span>
                {chips(course)}
                {course.progress !== null && (
                  <span className="mt-1 grid gap-1">
                    {progressBar(course.progress)}
                    <small className="text-[11px] text-muted-foreground">
                      Hoàn thành {course.progress}%
                    </small>
                  </span>
                )}
              </span>
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

function CreateCourse({
  units,
  onClose,
  onCreated,
}: {
  units: { id: string; code: string; name: string }[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { accessToken } = useApp();
  const [unitId, setUnitId] = useState(units[0]?.id ?? "");
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [enrollment, setEnrollment] = useState<CourseEnrollmentMode>("open");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;
    setBusy(true);
    setError("");
    try {
      onCreated(
        (
          await coursesApi.create(accessToken, {
            unitId,
            code: code.trim().toUpperCase(),
            title: title.trim(),
            description: description.trim(),
            enrollment,
          })
        ).id,
      );
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
          <Button variant="ghost" onClick={onClose}>
            Hủy
          </Button>
          <Button type="submit" form="create-course" disabled={busy}>
            Tạo
          </Button>
        </>
      }
    >
      <form
        id="create-course"
        className="tw tw-form grid gap-2.5"
        onSubmit={(event) => void submit(event)}
      >
        <Field label="Đơn vị phụ trách">
          <select value={unitId} onChange={(event) => setUnitId(event.target.value)} required>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Mã khóa học" hint="2–20 ký tự in hoa, số, - hoặc _, ví dụ CC-101">
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
            pattern="[A-Za-z0-9_-]{2,20}"
          />
        </Field>
        <Field label="Tên khóa học">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            maxLength={160}
          />
        </Field>
        <Field label="Mô tả">
          <textarea
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={4000}
          />
        </Field>
        <Field label="Ghi danh">
          <select
            value={enrollment}
            onChange={(event) => setEnrollment(event.target.value as CourseEnrollmentMode)}
          >
            <option value="open">Mở: học viên tự đăng ký</option>
            <option value="assigned">Chỉ định: giảng viên gán học viên</option>
            <option value="approval">Cần duyệt: học viên gửi yêu cầu, giảng viên duyệt</option>
          </select>
        </Field>
        {error && (
          <p
            role="alert"
            className="tw rounded-md bg-red-50 px-3 py-2 text-[13px] text-red-700 dark:bg-red-950 dark:text-red-300"
          >
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
