import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../../app/providers/AppContext";
import { useSocket } from "../../app/providers/SocketContext";
import { Badge, Button } from "../../shared/ui/Primitives";
import { Icon } from "../../shared/ui/Icon";
import { academicApi, AcademicError, type AcademicProfile, type TermDetail, type TermSummary } from "./api";
import { ThesisContext, type ThesisContextValue } from "./context";
import { termLabel, termPhases } from "./labels";
import { OverviewPanel } from "./OverviewPanel";
import { TopicsPanel } from "./TopicsPanel";
import { GroupPanel, RegistrationsPanel } from "./GroupPanel";
import { ProjectsPanel } from "./ProjectsPanel";
import { ProjectDetailView } from "./ProjectDetail";
import { CommitteesPanel } from "./CommitteesPanel";
import { TermAdminPanel } from "./TermAdminPanel";
import { SetupPanel } from "./SetupPanel";
import { AccessPanel } from "./AccessPanel";
import { AcademicInbox } from "./AcademicInbox";
import "../workspaces/workspace-admin.css";
import "./thesis.css";

type TabId = "overview" | "topics" | "group" | "registrations" | "projects" | "committees" | "manage" | "setup" | "access";

export function ThesisPage() {
  const { accessToken, route, navigate, notify } = useApp();
  const { socket } = useSocket();
  const [profile, setProfile] = useState<AcademicProfile | null>(null);
  const [terms, setTerms] = useState<TermSummary[]>([]);
  const [term, setTerm] = useState<TermDetail | null>(null);
  const [tab, setTab] = useState<TabId>("overview");
  const [revision, setRevision] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [unread, setUnread] = useState(0);
  const [inboxOpen, setInboxOpen] = useState(false);
  const termId = route.termId ?? terms[0]?.id;

  const loadTerms = useCallback(async () => {
    if (!accessToken) return;
    try {
      const [me, list] = await Promise.all([
        academicApi<AcademicProfile>(accessToken, "me"),
        academicApi<{ terms: TermSummary[] }>(accessToken, "terms"),
      ]);
      setProfile(me);
      setTerms(list.terms);
      setLoadError("");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Không tải được dữ liệu đồ án.");
    }
  }, [accessToken]);

  const loadTerm = useCallback(async () => {
    if (!accessToken || !termId) return setTerm(null);
    try {
      setTerm(await academicApi<TermDetail>(accessToken, `terms/${termId}`));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Không tải được đợt đồ án.");
    }
  }, [accessToken, termId]);

  useEffect(() => void loadTerms(), [loadTerms]);
  useEffect(() => void loadTerm(), [loadTerm, revision]);

  useEffect(() => {
    if (!accessToken) return;
    const refresh = () =>
      void academicApi<{ unread: number }>(accessToken, "notifications?unread=true")
        .then((page) => setUnread(page.unread))
        .catch(() => undefined);
    const onPush = (data: { unread: number }) => {
      setUnread(data.unread);
      // Another actor changed something this user cares about: refresh the open view.
      setRevision((value) => value + 1);
    };
    refresh();
    socket?.on("academic_notification", onPush);
    return () => {
      socket?.off("academic_notification", onPush);
    };
  }, [accessToken, socket]);

  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const run = useCallback<ThesisContextValue["run"]>(
    async (label, action, options = {}) => {
      try {
        const result = await action();
        if (!options.silent) notify(label);
        if (options.reload !== false) reload();
        return result;
      } catch (error) {
        const blockers = error instanceof AcademicError ? error.blockers ?? error.details?.map((d) => `Dòng ${d.row}: ${d.message}`) : undefined;
        notify(error instanceof Error ? error.message : "Thao tác thất bại.", blockers?.slice(0, 4).join(" · "), "warning");
        return undefined;
      }
    },
    [notify, reload],
  );
  const openProject = useCallback(
    (projectId: string | null) => navigate({ view: "thesis", termId, projectId: projectId ?? undefined }),
    [navigate, termId],
  );

  const tabs = useMemo(() => {
    const viewer = term?.viewer;
    const list: { id: TabId; label: string; show: boolean }[] = [
      { id: "overview", label: "Tổng quan", show: Boolean(term) },
      { id: "topics", label: "Đề tài", show: Boolean(term) },
      { id: "group", label: "Nhóm của tôi", show: Boolean(viewer?.student) },
      { id: "registrations", label: "Nguyện vọng chờ duyệt", show: Boolean(viewer?.lecturer) },
      { id: "projects", label: "Đồ án", show: Boolean(term) },
      { id: "committees", label: "Hội đồng & lịch", show: Boolean(viewer && (viewer.admin || viewer.head || viewer.lecturer)) },
      { id: "manage", label: "Quản trị đợt", show: Boolean(viewer?.admin) },
      { id: "setup", label: "Thiết lập khoa", show: Boolean(profile && (profile.systemAdmin || Object.values(profile.unitRoles).some((r) => r.includes("unit_admin")))) },
      { id: "access", label: "Tài khoản & phân quyền", show: Boolean(profile?.systemAdmin) },
    ];
    return list.filter((item) => item.show);
  }, [term, profile]);
  // No tab at all (no term, no setup rights) leaves the "no term" notice instead of an empty setup panel.
  const activeTab = tabs.some((item) => item.id === tab) ? tab : tabs[0]?.id;

  if (!accessToken) return null;
  if (loadError && !profile)
    return (
      <section className="workspace-admin" role="alert">
        <h1>Đồ án tốt nghiệp</h1>
        <p className="inline-alert">{loadError}</p>
        <Button icon="refresh" onClick={() => void loadTerms()}>Thử lại</Button>
      </section>
    );
  if (!profile) return <p className="loading-note thesis-loading" role="status">Đang tải dữ liệu đồ án…</p>;

  const context: ThesisContextValue = { token: accessToken, profile, term, reload, revision, run, openProject };
  const phaseIndex = term ? termPhases.findIndex((phase) => phase.id === term.status) : -1;

  return (
    <ThesisContext.Provider value={context}>
      <div className="workspace-admin thesis-page">
        <header className="thesis-header">
          <div>
            <p className="thesis-eyebrow">Quản lý & hướng dẫn đồ án tốt nghiệp</p>
            <h1>{term ? term.name : "Đồ án tốt nghiệp"}</h1>
            {term && (
              <p className="thesis-subtitle">
                Mã đợt <strong>{term.code}</strong> · Hạn nộp báo cáo {new Date(term.finalDueAt).toLocaleDateString("vi-VN")} · Bảo vệ {new Date(term.defenseStartsOn).toLocaleDateString("vi-VN")} – {new Date(term.defenseEndsOn).toLocaleDateString("vi-VN")}
              </p>
            )}
          </div>
          <div className="thesis-header__actions">
            {terms.length > 1 && (
              <label className="thesis-term-picker">
                <span>Đợt</span>
                <select value={termId ?? ""} onChange={(event) => navigate({ view: "thesis", termId: event.target.value })}>
                  {terms.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code} · {termLabel(item.status)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Button variant="secondary" icon="bell" onClick={() => setInboxOpen(true)} aria-label={`Thông báo đồ án, ${unread} chưa đọc`}>
              Thông báo {unread > 0 && <Badge tone="red">{unread}</Badge>}
            </Button>
          </div>
        </header>

        {term && (
          <ol className="thesis-phases" aria-label="Tiến trình đợt đồ án">
            {termPhases.map((phase, index) => (
              <li key={phase.id} className={index < phaseIndex ? "is-done" : index === phaseIndex ? "is-current" : ""} aria-current={index === phaseIndex ? "step" : undefined}>
                <span className="thesis-phases__dot">{index < phaseIndex ? <Icon name="check" size={12} /> : index + 1}</span>
                <span>{phase.label}</span>
              </li>
            ))}
          </ol>
        )}

        {route.projectId ? (
          <ProjectDetailView projectId={route.projectId} />
        ) : (
          <>
            {tabs.length > 0 && (
              <nav className="thesis-tabs" role="tablist" aria-label="Phân hệ đồ án">
                {tabs.map((item) => (
                  <button key={item.id} role="tab" type="button" aria-selected={activeTab === item.id} className={activeTab === item.id ? "is-active" : ""} onClick={() => setTab(item.id)}>
                    {item.label}
                  </button>
                ))}
              </nav>
            )}
            {!term && activeTab !== "setup" && activeTab !== "access" && (
              <div className="state-card">
                <h3>Chưa có đợt đồ án</h3>
                <p>Bạn chưa thuộc đợt đồ án nào. Giáo vụ khoa cần tạo đợt và ghi danh sinh viên, hoặc phân công bạn làm giảng viên của khoa.</p>
              </div>
            )}
            <div role="tabpanel">
              {activeTab === "overview" && term && <OverviewPanel />}
              {activeTab === "topics" && term && <TopicsPanel />}
              {activeTab === "group" && term && <GroupPanel />}
              {activeTab === "registrations" && term && <RegistrationsPanel />}
              {activeTab === "projects" && term && <ProjectsPanel />}
              {activeTab === "committees" && term && <CommitteesPanel />}
              {activeTab === "manage" && term && <TermAdminPanel />}
              {activeTab === "access" && <AccessPanel />}
              {activeTab === "setup" && <SetupPanel onTermCreated={(id) => { void loadTerms(); navigate({ view: "thesis", termId: id }); }} />}
            </div>
          </>
        )}
      </div>
      {inboxOpen && (
        <AcademicInbox
          onClose={() => setInboxOpen(false)}
          onRead={setUnread}
          onOpenProject={(projectId) => {
            setInboxOpen(false);
            openProject(projectId);
          }}
        />
      )}
    </ThesisContext.Provider>
  );
}
