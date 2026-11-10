import { useEffect, useState } from "react";
import type { GroupMemberItem, MeetingInviteInput, WorkspaceItem } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { Field } from "../../shared/ui/Primitives";
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

  return (
    <Field
      label="Người được mời"
      hint="Người được mời vào thẳng; người khác phải chờ duyệt nếu bật phòng chờ."
    >
      <div className="meeting-invite">
        <select
          value={value.mode}
          onChange={(event) =>
            onChange({ ...value, mode: event.target.value as InviteState["mode"] })
          }
        >
          <option value="all">Cả nhóm của phòng họp</option>
          <option value="list">Chọn người, lớp hoặc đơn vị</option>
        </select>
        {value.mode === "list" && (
          <>
            <fieldset>
              <legend>Thành viên nhóm</legend>
              {members.map((member) => (
                <label key={member.userId}>
                  <input
                    type="checkbox"
                    checked={value.userIds.includes(member.userId)}
                    onChange={(event) => toggle("userIds", member.userId, event.target.checked)}
                  />
                  {member.displayName}
                </label>
              ))}
            </fieldset>
            {otherGroups.length > 0 && (
              <fieldset>
                <legend>Mời cả lớp (nhóm khác)</legend>
                {otherGroups.map((group) => (
                  <label key={group.id}>
                    <input
                      type="checkbox"
                      checked={value.workspaceIds.includes(group.id)}
                      onChange={(event) => toggle("workspaceIds", group.id, event.target.checked)}
                    />
                    {group.name}
                  </label>
                ))}
              </fieldset>
            )}
            {units.length > 0 && (
              <fieldset>
                <legend>Mời cả đơn vị</legend>
                {units.map((unit) => (
                  <label key={unit.id}>
                    <input
                      type="checkbox"
                      checked={value.unitIds.includes(unit.id)}
                      onChange={(event) => toggle("unitIds", unit.id, event.target.checked)}
                    />
                    {unit.code ? `${unit.code} · ${unit.name}` : unit.name}
                  </label>
                ))}
              </fieldset>
            )}
            <small>
              Người ngoài nhóm sẽ được thêm vào nhóm của phòng họp (cần quyền chủ hoặc quản trị
              nhóm).
            </small>
          </>
        )}
      </div>
    </Field>
  );
}
