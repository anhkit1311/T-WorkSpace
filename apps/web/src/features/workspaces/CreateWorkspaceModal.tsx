import type { ComponentProps } from "react";
import { Modal } from "../../shared/ui/Primitives";

/** Retain both approved form variants verbatim; share dialog behaviour and validation. */
export function CreateWorkspaceModal(props: ComponentProps<typeof Modal>) {
  return <Modal {...props} initialFocus="input:not(:disabled)" />;
}
export function workspaceNameError(value: string) {
  return value.trim().length < 2 ? "Tên nhóm cần có ít nhất 2 ký tự." : "";
}
