import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useIsPresent, type HTMLMotionProps } from "motion/react";
import { prefersReducedMotion, SPRING } from "../../shared/motion/tokens";
import { useMotionSafe } from "../../shared/motion/MotionProvider";
import type {
  GlobalMessageSearchItem,
  WorkspaceItem,
  ChannelItem,
  GroupMemberItem,
} from "@doan/shared";
import type { ViewId } from "../../app/types";
import {
  searchMessagesApi,
  getWorkspacesApi,
  getChannelsApi,
  getWorkspaceMembersApi,
} from "../chat/api";
import { Icon, type IconName } from "../../shared/ui/Icon";
import { isSelectPickerEvent } from "../../shared/lib/select-picker";
import { UserAvatar } from "../../shared/ui/kit/user-avatar";
import { cn } from "../../shared/lib/utils";
import { timeLabel } from "../announcements/day";

const ICON_BTN =
  "grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground";
const KBD =
  "rounded-[5px] border bg-background px-1.5 py-0.5 font-mono text-[11px] font-semibold text-muted-foreground";
const GROUP =
  "flex items-center gap-2 px-2.5 pt-2.5 pb-1 text-[11.5px] font-semibold text-muted-foreground";
const STATUS = "px-2.5 py-3 text-[13px] text-muted-foreground";

interface Props {
  isOpen: boolean;
  accessToken: string | null;
  onClose: () => void;
  onSelectView: (view: ViewId) => void;
  onSelectMessage: (message: GlobalMessageSearchItem, query: string) => void;
}

const termKey = (value: string) => value.trim();

// The fading surface must release input immediately so fast reopen clicks reach the trigger.
function SearchBackdrop(props: HTMLMotionProps<"div">) {
  const present = useIsPresent();
  return (
    <motion.div
      {...props}
      inert={!present}
      aria-hidden={!present || undefined}
      style={{ ...props.style, pointerEvents: present ? undefined : "none" }}
    />
  );
}

// Titles match the dock labels; descriptions carry synonyms so either wording is searchable.
const pages: { id: ViewId; title: string; desc: string; icon: IconName }[] = [
  {
    id: "overview",
    title: "Trang chủ",
    desc: "Tổng quan toàn hệ thống, ưu tiên cá nhân & lời mời nhóm",
    icon: "home",
  },
  {
    id: "call-center",
    title: "Tổng đài",
    desc: "Bàn làm việc tổng đài viên, softphone, hàng đợi, giám sát, phiếu yêu cầu, VoIP",
    icon: "headset",
  },
  {
    id: "call-directory",
    title: "Danh sách cuộc gọi",
    desc: "Lịch sử cuộc gọi, ghi âm, kết quả & chấm điểm chất lượng",
    icon: "phone-call",
  },
  {
    id: "call-monitoring",
    title: "Giám sát tổng đài",
    desc: "Bảng điều hành thời gian thực, trạng thái tổng đài viên, hàng đợi & cấu hình",
    icon: "activity",
  },
  {
    id: "elearning",
    title: "Khóa học",
    desc: "E-learning: bài video, tài liệu, bài kiểm tra, chứng nhận",
    icon: "graduation-cap",
  },
  {
    id: "staff",
    title: "Danh sách nhân sự",
    desc: "Danh bạ giảng viên, chuyên viên, khoa phòng ban & liên hệ nội bộ",
    icon: "users",
  },
  {
    id: "chat",
    title: "Tin nhắn",
    desc: "Kênh của mọi nhóm và trò chuyện riêng, chủ đề phản hồi & tệp chia sẻ",
    icon: "message",
  },
  {
    id: "meetings",
    title: "Họp",
    desc: "Lịch họp theo tuần của mọi nhóm, họp ngay, bản ghi & biên bản",
    icon: "video",
  },
  {
    id: "notifications",
    title: "Thông báo",
    desc: "Nhắc tên & phản hồi trong chủ đề bạn tham gia",
    icon: "bell",
  },
  {
    id: "profile",
    title: "Hồ sơ cá nhân",
    desc: "Thông tin tài khoản, ảnh đại diện & quyền riêng tư",
    icon: "profile",
  },
];

function highlightQuery(text: string, term: string) {
  const clean = term.trim();
  if (clean.length < 2) return text;
  const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return parts.map((part, idx) =>
    part.toLowerCase() === clean.toLowerCase() ? (
      <mark key={idx} className="rounded-[3px] bg-[#fff1b8] px-0.5 text-inherit dark:bg-[#5a4a00]">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

export function NotionSearchModal({
  isOpen,
  accessToken,
  onClose,
  onSelectView,
  onSelectMessage,
}: Props) {
  const safe = useMotionSafe();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalMessageSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [members, setMembers] = useState<GroupMemberItem[]>([]);
  const [workspace, setWorkspace] = useState("");
  const [channel, setChannel] = useState("");
  const [author, setAuthor] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [file, setFile] = useState("");

  const activeFilterCount = [workspace, channel, author, from, to, file].filter(Boolean).length;

  const resetFilters = () => {
    setWorkspace("");
    setChannel("");
    setAuthor("");
    setFrom("");
    setTo("");
    setFile("");
  };

  const dayBound = (value: string, end = false) => {
    const date = new Date(`${value}T${end ? "23:59:59.999" : "00:00:00"}`);
    return value && Number.isFinite(date.getTime()) ? date.toISOString() : "";
  };

  const filters = {
    workspace,
    channel,
    author,
    from: dayBound(from),
    to: dayBound(to, true),
    file,
  };

  const searchKey = JSON.stringify([isOpen, accessToken, termKey(query), filters]);
  const searchKeyRef = useRef(searchKey);
  searchKeyRef.current = searchKey;

  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  const term = query.trim();
  const matchingPages = pages.filter(
    (page) =>
      page.title.toLowerCase().includes(term.toLowerCase()) ||
      page.desc.toLowerCase().includes(term.toLowerCase()),
  );
  const visibleResults = term.length >= 2 ? results : [];
  const totalItems = visibleResults.length + matchingPages.length;

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() =>
      inputRef.current?.focus({ preventScroll: true }),
    );
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !accessToken || term.length < 2) return;
    setLoading(true);
    setResults([]);
    setError("");
    setHasMore(false);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      searchMessagesApi(accessToken, term, controller.signal, filters)
        .then((items) => {
          setResults(items);
          setHasMore(items.length === 30);
          setLoading(false);
        })
        .catch((cause) => {
          if (controller.signal.aborted) return;
          setError(cause instanceof Error ? cause.message : "Không thể tìm tin nhắn.");
          setLoading(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [isOpen, accessToken, term, workspace, channel, author, from, to, file]);

  useEffect(() => {
    if (!isOpen || !accessToken) return;
    let active = true;
    void getWorkspacesApi(accessToken)
      .then((items) => {
        if (active) setWorkspaces(items);
      })
      .catch((reason) => {
        if (active)
          setError(reason instanceof Error ? reason.message : "Không tải được nhóm tìm kiếm.");
      });
    return () => {
      active = false;
    };
  }, [isOpen, accessToken]);

  useEffect(() => {
    setChannels([]);
    setMembers([]);
    setChannel("");
    setAuthor("");
    if (!isOpen || !accessToken || !workspace) return;
    let active = true;
    void Promise.all([
      getChannelsApi(accessToken, workspace),
      getWorkspaceMembersApi(accessToken, workspace),
    ])
      .then(([items, people]) => {
        if (active) {
          setChannels(items);
          setMembers(people);
        }
      })
      .catch((reason) => {
        if (active)
          setError(reason instanceof Error ? reason.message : "Không tải được bộ lọc tìm kiếm.");
      });
    return () => {
      active = false;
    };
  }, [workspace, isOpen, accessToken]);

  useEffect(() => {
    if (isOpen) return;
    setQuery("");
    setResults([]);
    setError("");
    setLoading(false);
    setSelectedIndex(0);
    setFiltersOpen(false);
    resetFilters();
    setHasMore(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSelectPickerEvent(event)) onClose();
      if (event.key !== "Tab" || !dialogRef.current) return;
      const controls = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(
          "input:not(:disabled), select:not(:disabled), button:not(:disabled)",
        ),
      ];
      if (!controls.length) return;
      if (event.shiftKey && document.activeElement === controls[0]) {
        event.preventDefault();
        controls[controls.length - 1].focus();
      } else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) {
        event.preventDefault();
        controls[0].focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    const el = rowRefs.current.get(selectedIndex);
    el?.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [selectedIndex]);

  const selectIndex = (index: number) => {
    if (index < visibleResults.length) onSelectMessage(visibleResults[index], term);
    else {
      const page = matchingPages[index - visibleResults.length];
      if (page) onSelectView(page.id);
    }
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!totalItems) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((index) => (index + 1) % totalItems);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((index) => (index - 1 + totalItems) % totalItems);
    } else if (event.key === "Enter") {
      event.preventDefault();
      selectIndex(Math.min(selectedIndex, totalItems - 1));
    }
  };

  const row = (index: number, selected: boolean) => ({
    role: "option" as const,
    id: `global-search-option-${index}`,
    "aria-selected": selected,
    type: "button" as const,
    ref: (el: HTMLButtonElement | null) => {
      if (el) rowRefs.current.set(index, el);
      else rowRefs.current.delete(index);
    },
    onMouseEnter: () => setSelectedIndex(index),
    className: cn(
      "flex w-full cursor-pointer gap-[11px] rounded-[9px] px-2.5 py-[9px] text-left",
      selected && "bg-secondary",
    ),
  });
  const filterClass = (value: string) =>
    cn(
      "h-[30px]! rounded-[7px]! px-2! py-0! text-[12.5px]!",
      value && "border-brand! bg-brand-soft! font-semibold text-brand!",
    );

  return (
    <AnimatePresence>
      {isOpen && (
        <SearchBackdrop
          className="tw fixed inset-0 z-[200] flex items-start justify-center bg-black/45 px-4 pt-[12vh] pb-4 backdrop-blur-[2px] max-md:p-0"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: safe.duration(0.16) }}
        >
          <motion.div
            ref={dialogRef}
            className="flex max-h-[72vh] w-[min(680px,100%)] flex-col overflow-hidden rounded-[14px] border bg-card text-sm text-foreground shadow-[0_24px_64px_rgba(0,0,0,.3)] max-md:h-screen max-md:max-h-screen max-md:rounded-none"
            role="dialog"
            aria-modal="true"
            aria-label="Tìm kiếm toàn bộ tin nhắn và trang"
            onClick={(event) => event.stopPropagation()}
            initial={
              safe.reduced ? false : { opacity: 0, scale: 0.94, y: -16, filter: safe.blur(10) }
            }
            animate={{ opacity: 1, scale: 1, y: 0, filter: safe.blur(0) }}
            exit={{
              opacity: safe.reduced ? 1 : 0,
              scale: safe.reduced ? 1 : 0.96,
              y: safe.reduced ? 0 : -12,
              filter: safe.blur(6),
              transition: { duration: 0.16, ease: [0.16, 1, 0.3, 1] },
            }}
            transition={{
              default: SPRING.pop,
              opacity: { duration: 0.28, ease: [0.16, 1, 0.3, 1] },
              filter: { duration: 0.3, ease: [0.16, 1, 0.3, 1] },
            }}
          >
            <div className="flex h-14 shrink-0 items-center gap-2.5 border-b pr-3 pl-4">
              <Icon name="search" size={18} className="shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded="true"
                aria-controls="global-search-results"
                aria-activedescendant={
                  visibleResults.length + matchingPages.length > selectedIndex
                    ? `global-search-option-${selectedIndex}`
                    : undefined
                }
                name="globalSearch"
                autoComplete="off"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setResults([]);
                  setError("");
                  setLoading(event.target.value.trim().length >= 2);
                  setSelectedIndex(0);
                }}
                onKeyDown={handleInputKeyDown}
                placeholder="Tìm tin nhắn, tệp, người gửi hoặc chuyển trang…"
                aria-label="Tìm tin nhắn hoặc trang"
                className="min-w-0 flex-1 bg-transparent text-[15.5px] outline-none"
              />
              {query && (
                <button
                  type="button"
                  className={ICON_BTN}
                  onClick={() => {
                    setQuery("");
                    setResults([]);
                    setError("");
                    setSelectedIndex(0);
                    inputRef.current?.focus();
                  }}
                  aria-label="Xóa tìm kiếm"
                >
                  <Icon name="x" size={16} />
                </button>
              )}
              <button
                type="button"
                className={cn(
                  "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground",
                  filtersOpen && "bg-secondary font-semibold text-foreground",
                )}
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen((prev) => !prev)}
              >
                <Icon name="filter" size={15} />
                Bộ lọc
                {activeFilterCount > 0 && (
                  <b className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-brand px-[5px] text-[11px] text-white">
                    {activeFilterCount}
                  </b>
                )}
              </button>
              <button
                type="button"
                className={cn(ICON_BTN, "md:hidden")}
                onClick={onClose}
                aria-label="Đóng"
              >
                <Icon name="x" size={18} />
              </button>
              <kbd className={cn(KBD, "max-md:hidden")}>Esc</kbd>
            </div>

            {filtersOpen && (
              <div className="tw-form flex shrink-0 flex-wrap items-center gap-1.5 border-b bg-background px-3.5 py-2.5">
                <select
                  aria-label="Nhóm"
                  className={filterClass(workspace)}
                  value={workspace}
                  onChange={(event) => setWorkspace(event.target.value)}
                >
                  <option value="">Mọi nhóm</option>
                  {workspaces.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Kênh"
                  className={filterClass(channel)}
                  value={channel}
                  disabled={!workspace}
                  title={workspace ? undefined : "Chọn nhóm trước"}
                  onChange={(event) => setChannel(event.target.value)}
                >
                  <option value="">Mọi kênh</option>
                  {channels.map((item) => (
                    <option key={item.id} value={item.id}>
                      #{item.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Người gửi"
                  className={filterClass(author)}
                  value={author}
                  disabled={!workspace}
                  title={workspace ? undefined : "Chọn nhóm trước"}
                  onChange={(event) => setAuthor(event.target.value)}
                >
                  <option value="">Mọi người gửi</option>
                  {members.map((item) => (
                    <option key={item.userId} value={item.userId}>
                      {item.displayName}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Định dạng tệp"
                  className={filterClass(file)}
                  value={file}
                  onChange={(event) => setFile(event.target.value)}
                >
                  <option value="">Mọi nội dung</option>
                  <option value="any">Có tệp đính kèm</option>
                  <option value="image">Hình ảnh / GIF</option>
                  <option value="audio">Tin nhắn âm thanh</option>
                  <option value="document">Tài liệu văn bản</option>
                </select>
                <input
                  type="date"
                  aria-label="Từ ngày"
                  className={filterClass(from)}
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                />
                <span className="text-xs text-muted-foreground">–</span>
                <input
                  type="date"
                  aria-label="Đến ngày"
                  className={filterClass(to)}
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                />
                {activeFilterCount > 0 && (
                  <button
                    type="button"
                    className="ml-auto cursor-pointer text-[12.5px] font-semibold text-muted-foreground hover:text-foreground"
                    onClick={resetFilters}
                  >
                    Đặt lại
                  </button>
                )}
              </div>
            )}

            <span className="sr-only" role="status" aria-live="polite">
              {loading ? "Đang tìm…" : `${visibleResults.length + matchingPages.length} kết quả`}
            </span>
            <div
              className="min-h-0 flex-1 overflow-y-auto p-1.5"
              id="global-search-results"
              role="listbox"
              aria-label="Kết quả tìm kiếm"
            >
              {term.length >= 2 && (
                <div role="group" aria-label="Tin nhắn">
                  <p className={GROUP}>
                    Tin nhắn · {results.length} kết quả
                    {loading && (
                      <span className="size-3 animate-spin rounded-full border-2 border-border border-t-muted-foreground" />
                    )}
                  </p>
                  {loading && results.length === 0 && (
                    <p className={STATUS}>Đang tìm kiếm tin nhắn trong hệ thống…</p>
                  )}
                  {error && (
                    <p className={cn(STATUS, "text-destructive")} role="alert">
                      {error}
                    </p>
                  )}
                  {!loading && !error && visibleResults.length === 0 && (
                    <p className={STATUS}>Không tìm thấy tin nhắn nào phù hợp với “{term}”.</p>
                  )}
                  {visibleResults.map((message, index) => (
                    <button
                      key={message.id}
                      {...row(index, selectedIndex === index)}
                      onClick={() => onSelectMessage(message, term)}
                    >
                      <UserAvatar name={message.authorName} className="size-[30px] text-[11px]" />
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-1.5 text-[13px]">
                          <b className="font-semibold whitespace-nowrap">{message.authorName}</b>
                          <span className="min-w-0 truncate text-muted-foreground">
                            {message.workspaceId
                              ? `#${message.channelName} · ${message.workspaceName}`
                              : message.channelName}
                          </span>
                          <time
                            dateTime={message.createdAt}
                            title={new Date(message.createdAt).toLocaleString("vi-VN")}
                            className="ml-auto pl-2 text-xs whitespace-nowrap text-muted-foreground"
                          >
                            {timeLabel(message.createdAt)}
                          </time>
                        </span>
                        <span className="mt-0.5 line-clamp-2 text-[13.5px]">
                          {highlightQuery(message.content, term)}
                        </span>
                      </span>
                    </button>
                  ))}
                  {hasMore && (
                    <div className="flex justify-center pt-1.5 pb-1">
                      <button
                        type="button"
                        className="cursor-pointer rounded-[7px] px-3 py-1.5 text-[12.5px] font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-60"
                        disabled={loading}
                        onClick={() => {
                          const key = searchKey;
                          setLoading(true);
                          void searchMessagesApi(accessToken!, term, undefined, {
                            ...filters,
                            before: results.at(-1)!.id,
                          })
                            .then((items) => {
                              if (key !== searchKeyRef.current) return;
                              setResults((old) => [
                                ...old,
                                ...items.filter(
                                  (item) => !old.some((other) => other.id === item.id),
                                ),
                              ]);
                              setHasMore(items.length === 30);
                            })
                            .catch((reason) => {
                              if (key === searchKeyRef.current) setError(reason.message);
                            })
                            .finally(() => {
                              if (key === searchKeyRef.current) setLoading(false);
                            });
                        }}
                      >
                        {loading ? "Đang tải thêm..." : "Tải thêm kết quả"}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {matchingPages.length > 0 && (
                <div role="group" aria-label="Trang">
                  <p className={GROUP}>{term.length >= 2 ? "Trang phù hợp" : "Điều hướng nhanh"}</p>
                  {matchingPages.map((page, index) => {
                    const globalIndex = visibleResults.length + index;
                    const selected = selectedIndex === globalIndex;
                    return (
                      <button
                        key={page.id}
                        {...row(globalIndex, selected)}
                        onClick={() => onSelectView(page.id)}
                      >
                        <span className="grid size-8 shrink-0 place-items-center rounded-lg border bg-card text-muted-foreground">
                          <Icon name={page.icon} size={16} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <b className="block text-[13.5px] font-semibold">{page.title}</b>
                          <span className="block truncate text-[12.5px] text-muted-foreground">
                            {page.desc}
                          </span>
                        </span>
                        <Icon
                          name="arrow-right"
                          size={15}
                          className={cn(
                            "shrink-0 self-center text-muted-foreground",
                            !selected && "opacity-0",
                          )}
                        />
                      </button>
                    );
                  })}
                </div>
              )}

              {!loading && !error && term.length < 2 && (
                <p className="px-3 pt-2.5 pb-3 text-[12.5px] text-muted-foreground">
                  Nhập từ 2 ký tự để tìm trong nội dung tin nhắn.
                </p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-3.5 border-t bg-background px-3.5 py-2 text-xs text-muted-foreground max-md:hidden">
              <span className="inline-flex items-center gap-[5px]">
                <kbd className={KBD}>↑</kbd>
                <kbd className={KBD}>↓</kbd>
                Di chuyển
              </span>
              <span className="inline-flex items-center gap-[5px]">
                <kbd className={KBD}>↵</kbd>
                Mở
              </span>
              <span className="inline-flex items-center gap-[5px]">
                <kbd className={KBD}>Esc</kbd>
                Đóng
              </span>
            </div>
          </motion.div>
        </SearchBackdrop>
      )}
    </AnimatePresence>
  );
}
