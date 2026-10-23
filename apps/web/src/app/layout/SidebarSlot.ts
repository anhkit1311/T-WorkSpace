import { createContext, useContext } from "react";

/**
 * The box under the active "Tổng đài" sidebar entry. The switchboard renders its own tabs into it
 * (they depend on the user's roles); it is null while the sidebar is collapsed or on phones.
 */
export const SidebarSlotContext = createContext<HTMLElement | null>(null);
export const useSidebarSlot = () => useContext(SidebarSlotContext);
