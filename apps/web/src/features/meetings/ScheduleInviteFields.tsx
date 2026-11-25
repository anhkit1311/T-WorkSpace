import { useEffect, useState } from "react";
import type { GroupMemberItem, MeetingInviteInput, WorkspaceItem } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { Icon } from "../../shared/ui/Icon";
import { UserAvatar } from "../../shared/ui/kit/user-avatar";
import { cn } from "../../shared/lib/utils";
import { SEG, SEG_BTN } from "../admin/ui";
import { academicApi, type AcademicProfile } from "../admin/api";
import { getWorkspaceMembersApi } from "../chat/api";

export type InviteState = {
  mode: "all" | "list";
  userIds: string[];
  workspaceIds: string[];
  unitIds: string[];
};

/** What the form sends: no list means everyone in the group is invited. */
export const inviteInput = (state: InviteState): MeetingInviteInput =>
  state.mode === "all"
    ? {}
    : { userIds: state.userIds, workspaceIds: state.workspaceIds, unitIds: state.unitIds };

/** NV-MT1: invite the whole group, or chosen people plus whole classes (groups) and units. */
export function ScheduleInviteFields({
  workspaceId,
  groups,
  value,
  onChange,
}: {
  workspaceId: string;
  groups: WorkspaceItem[];
  value: InviteState;
  onChange: (next: InviteState) => void;
}) {
  const { accessToken } = useApp();
  const [members, setMembers] = useState<GroupMemberItem[]>([]);
  const [units, setUnits] = useState<AcademicProfile["units"]>([]);
  const [search, setSearch] = useState("");
  useEffect(() => {
    if (!accessToken || !workspaceId) return;
    void getWorkspaceMembersApi(accessToken, workspaceId).then(
      (list) => setMembers(list.filter((member) => member.status === "active")),
      () => setMembers([]),
    );
  }, [accessToken, workspaceId]);
  useEffect(() => {
    if (!accessToken) return;
    void academicApi<AcademicProfile>(accessToken, "me").then(
      (profile) => setUnits(profile.units),
      () => setUnits([]),
    );
  }, [accessToken]);

  const toggle = (key: "userIds" | "workspaceIds" | "unitIds", id: string, on: boolean) =>
    onChange({
      ...value,
      [key]: on ? [...value[key], id] : value[key].filter((item) => item !== id),
    });
  const otherGroups = groups.filter((group) => group.id !== workspaceId);
  const needle = search.trim().toLowerCase();
  const match = (text: string) => !needle || text.toLowerCase().includes(needle);
  const unitName = (unit: AcademicProfile["units"][number]) =>
    unit.code ? `${unit.code} · ${unit.name}` : unit.name;
  // Everything chosen so far, as removable tags above the list.
  const chosen = [
    ...members
      .filter((member) => value.userIds.includes(member.userId))
      .map((member) => ({
        key: "userIds" as const,
        id: member.userId,
        name: member.displayName,
        tone: "",
      })),
    ...otherGroups
      .filter((group) => value.workspaceIds.includes(group.id))
      .map((group) => ({
        key: "workspaceIds" as const,
        id: group.id,
        name: group.name,
        tone: "violet",
      })),
    ...units
      .filter((unit) => value.unitIds.includes(unit.id))
      .map((unit) => ({
        key: "unitIds" as const,
        id: unit.id,
        name: unitName(unit),
        tone: "green",
      })),
  ];
  const sections = [
    {
      title: "Thành viên nhóm",
      key: "userIds" as const,
      tone: "",
      items: members
        .filter((m) => match(m.displayName))
        .map((m) => ({ id: m.userId, name: m.displayName })),
    },
    {
      title: "Mời cả lớp (nhóm khác)",
      key: "workspaceIds" as const,
      tone: "violet",
      items: otherGroups.filter((g) => match(g.name)).map((g) => ({ id: g.id, name: g.name })),
    },
    {
      title: "Mời cả đơn vị",
      key: "unitIds" as const,
      tone: "green",
      items: units.filter((u) => match(unitName(u))).map((u) => ({ id: u.id, name: unitName(u) })),
    },
  ].filter((section) => section.items.length);
  const face = (name: string, tone: string, size: string) => (
    <UserAvatar
      name={name}
      className={cn(
        size,
        tone === "violet" && "bg-[var(--tint-violet-bg)] text-[var(--tint-violet-fg)]",
        tone === "green" && "bg-[var(--tint-green-bg)] text-[var(--tint-green-fg)]",
      )}
    />
  );

  return (
    <div className="grid gap-2">
      <span className="text-xs font-semibold tracking-[.05em] text-muted-foreground uppercase">
        Người được mời
      </span>
      <div className={cn(SEG, "w-full")} role="group" aria-label="Người được mời">
        {(
          [
            ["all", "Cả nhóm của phòng họp"],
            ["list", "Chọn người, lớp, đơn vị"],
          ] as const
        ).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            className={cn(SEG_BTN, "flex-1")}
            aria-pressed={value.mode === mode}
            onClick={() => onChange({ ...value, mode })}
          >
            {label}
          </button>
        ))}
      </div>
      {value.mode === "all" ? (
        <small className="text-xs text-muted-foreground">
          Người được mời vào thẳng; người khác phải chờ duyệt nếu bật phòng chờ.
        </small>
      ) : (
        <>
          {chosen.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {chosen.map((tag) => (
                <span
                  key={`${tag.key}-${tag.id}`}
                  className="inline-flex items-center gap-1.5 rounded-full bg-secondary py-0.5 pr-1 pl-0.5 text-[12.5px]"
                >
                  {face(tag.name, tag.tone, "size-5 text-[9px]")}
                  {tag.name}
                  <button
                    type="button"
                    className="grid size-4 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-card hover:text-foreground"
                    aria-label={`Bỏ ${tag.name}`}
                    onClick={() => toggle(tag.key, tag.id, false)}
                  >
                    <Icon name="x" size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="overflow-hidden rounded-[10px] border bg-card">
            <label className="flex! items-center gap-2 border-b px-3 py-2 text-muted-foreground">
              <Icon name="search" size={14} />
              <input
                type="search"
                className="w-0 min-w-0 flex-1 border-0! bg-transparent! p-0! text-[13.5px]! text-foreground outline-none"
                placeholder="Tìm người, lớp hoặc đơn vị"
                aria-label="Tìm người, lớp hoặc đơn vị"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <div className="max-h-[220px] overflow-y-auto p-1">
              {!sections.length && (
                <p className="px-2 py-3 text-[13px] text-muted-foreground">Không tìm thấy.</p>
              )}
              {sections.map((section) => (
                <div key={section.key}>
                  <h4 className="px-2 pt-2 pb-0.5 text-[11.5px] font-semibold tracking-[.05em] text-muted-foreground uppercase">
                    {section.title}
                  </h4>
                  {section.items.map((entry) => (
                    <label
                      key={entry.id}
                      className="flex! cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13.5px]! text-foreground! hover:bg-secondary"
                    >
                      <input
                        type="checkbox"
                        className="size-4 shrink-0 accent-foreground"
                        checked={value[section.key].includes(entry.id)}
                        onChange={(event) => toggle(section.key, entry.id, event.target.checked)}
                      />
                      {face(entry.name, section.tone, "size-[26px] text-[10.5px]")}
                      <span className="min-w-0 truncate">{entry.name}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <small className="text-xs text-muted-foreground">
            Người ngoài nhóm sẽ được thêm vào nhóm của phòng họp (cần quyền chủ hoặc quản trị nhóm).
          </small>
        </>
      )}
    </div>
  );
}
