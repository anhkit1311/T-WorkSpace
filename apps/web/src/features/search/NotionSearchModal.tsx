import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { prefersReducedMotion } from "../../shared/motion/tokens";
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
import "./search-enhancements.css";

interface Props {
  isOpen: boolean;
  accessToken: string | null;
  onClose: () => void;
  onSelectView: (view: ViewId) => void;
  onSelectMessage: (message: GlobalMessageSearchItem, query: string) => void;
}

const termKey = (value: string) => value.trim();

const pages: { id: ViewId; title: string; desc: string; icon: IconName }[] = [
  {
    id: "overview",
    title: "Trang chủ",
    desc: "Không gian làm việc & tổng quan hoạt động",
    icon: "home",
  },
  {
    id: "chat",
    title: "Tin nhắn",
    desc: "Kênh hội thoại, thảo luận & tệp chia sẻ",
    icon: "message",
  },
  {
    id: "meetings",
    title: "Cuộc họp video",
    desc: "Phòng họp trực tuyến bảo mật & chia sẻ màn hình",
    icon: "video",
  },
  {
    id: "profile",
    title: "Trang cá nhân",
    desc: "Cài đặt tài khoản & thông tin cá nhân",
    icon: "admin",
  },
];

export function NotionSearchModal({
  isOpen,
  accessToken,
  onClose,
  onSelectView,
  onSelectMessage,
}: Props) {
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
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
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
      .catch(reason => {if(active)setError(reason instanceof Error ? reason.message : "Không tải được nhóm tìm kiếm.");});
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
      .catch(reason => {if(active)setError(reason instanceof Error ? reason.message : "Không tải được bộ lọc tìm kiếm.");});
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

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="notion-search-backdrop"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <motion.div
            ref={dialogRef}
            className="notion-search-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Tìm kiếm toàn bộ tin nhắn và trang"
            onClick={(event) => event.stopPropagation()}
            initial={{ opacity: 0, scale: 0.96, y: -16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -12 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* Search Header Bar */}
            <div className="notion-search-head">
              <div className="notion-search-input-wrap">
                <Icon name="search" size={18} className="notion-search-head-icon" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="global-search-results"
                  aria-activedescendant={visibleResults.length + matchingPages.length > selectedIndex ? `global-search-option-${selectedIndex}` : undefined}
                  name="globalSearch" autoComplete="off"
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setResults([]);
                    setError("");
                    setLoading(event.target.value.trim().length >= 2);
                    setSelectedIndex(0);
                  }}
                  onKeyDown={handleInputKeyDown}
                  placeholder="Tìm kiếm tin nhắn, tệp, người gửi hoặc chuyển trang…"
                  aria-label="Tìm tin nhắn hoặc trang"
                  className="notion-search-input"
                />
                {query ? (
                  <button
                    type="button"
                    className="notion-search-clear-btn"
                    onClick={() => {
                      setQuery("");
                      setResults([]);
                      setError("");
                      setSelectedIndex(0);
                      inputRef.current?.focus();
                    }}
                    title="Xóa tìm kiếm"
                  >
                    <Icon name="x" size={14} />
                  </button>
                ) : (
                  <kbd className="notion-search-kbd">ESC</kbd>
                )}
              </div>

              <button
                type="button"
                className={`notion-search-filter-btn ${filtersOpen ? "is-active" : ""} ${activeFilterCount > 0 ? "has-filters" : ""}`}
                onClick={() => setFiltersOpen((prev) => !prev)}
                title="Bộ lọc tìm kiếm"
              >
                <Icon name="filter" size={15} />
                <span>Bộ lọc</span>
                {activeFilterCount > 0 && (
                  <span className="notion-search-filter-badge">{activeFilterCount}</span>
                )}
              </button>

              <button
                type="button"
                className="notion-search-close-btn"
                onClick={onClose}
                title="Đóng (Esc)"
              >
                <Icon name="x" size={18} />
              </button>
            </div>

            {/* Collapsible Filter Panel */}
            <AnimatePresence>
              {filtersOpen && (
                <motion.div
                  className="notion-search-filters-pane"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="notion-search-filters-header">
                    <span className="notion-search-filters-title">BỘ LỌC TÌM KIẾM NÂNG CAO</span>
                    {activeFilterCount > 0 && (
                      <button
                        type="button"
                        className="notion-search-reset-filters-btn"
                        onClick={resetFilters}
                      >
                        Đặt lại tất cả
                      </button>
                    )}
                  </div>
                  <div className="search-filter-grid">
                    <div className="search-filter-field">
                      <label htmlFor="search-filter-workspace">Nhóm</label>
                      <select
                        id="search-filter-workspace"
                        value={workspace}
                        onChange={(event) => setWorkspace(event.target.value)}
                      >
                        <option value="">Tất cả nhóm</option>
                        {workspaces.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="search-filter-field">
                      <label htmlFor="search-filter-channel">Kênh</label>
                      <select
                        id="search-filter-channel"
                        value={channel}
                        disabled={!workspace}
                        onChange={(event) => setChannel(event.target.value)}
                      >
                        <option value="">Tất cả kênh</option>
                        {channels.map((item) => (
                          <option key={item.id} value={item.id}>
                            #{item.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="search-filter-field">
                      <label htmlFor="search-filter-author">Người gửi</label>
                      <select
                        id="search-filter-author"
                        value={author}
                        disabled={!workspace}
                        onChange={(event) => setAuthor(event.target.value)}
                      >
                        <option value="">Tất cả mọi người</option>
                        {members.map((item) => (
                          <option key={item.userId} value={item.userId}>
                            {item.displayName}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="search-filter-field">
                      <label htmlFor="search-filter-file">Định dạng tệp</label>
                      <select
                        id="search-filter-file"
                        value={file}
                        onChange={(event) => setFile(event.target.value)}
                      >
                        <option value="">Bất kỳ nội dung</option>
                        <option value="any">Chứa tệp đính kèm</option>
                        <option value="image">Hình ảnh / GIF</option>
                        <option value="audio">Tin nhắn âm thanh</option>
                        <option value="document">Tài liệu văn bản</option>
                      </select>
                    </div>
                    <div className="search-filter-field">
                      <label htmlFor="search-filter-from">Từ ngày</label>
                      <input
                        id="search-filter-from"
                        type="date"
                        value={from}
                        onChange={(event) => setFrom(event.target.value)}
                      />
                    </div>
                    <div className="search-filter-field">
                      <label htmlFor="search-filter-to">Đến ngày</label>
                      <input
                        id="search-filter-to"
                        type="date"
                        value={to}
                        onChange={(event) => setTo(event.target.value)}
                      />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Scrollable Results Body */}
            <span className="sr-only" role="status" aria-live="polite">{loading ? "Đang tìm…" : `${visibleResults.length + matchingPages.length} kết quả`}</span>
            <div className="notion-search-body" id="global-search-results" role="listbox" aria-label="Kết quả tìm kiếm">
              {/* Message Search Results */}
              {term.length >= 2 && (
                <div className="notion-search-group">
                  <div className="notion-search-group-header">
                    <span className="notion-search-group-title">
                      TIN NHẮN · {results.length} KẾT QUẢ
                    </span>
                    {loading && (
                      <span className="notion-search-group-loading">Đang tìm…</span>
                    )}
                  </div>

                  {loading && results.length === 0 && (
                    <div className="notion-search-status" role="status">
                      <div className="notion-search-spinner" />
                      <span>Đang tìm kiếm tin nhắn trong hệ thống…</span>
                    </div>
                  )}

                  {error && (
                    <div className="notion-search-status has-error" role="alert">
                      <span>{error}</span>
                    </div>
                  )}

                  {!loading && !error && visibleResults.length === 0 && (
                    <div className="notion-search-status">
                      <span>Không tìm thấy tin nhắn nào phù hợp với &ldquo;{term}&rdquo;.</span>
                    </div>
                  )}

                  <div className="notion-search-messages-list">
                    {visibleResults.map((message, index) => {
                      const isSelected = selectedIndex === index;
                      return (
                        <button
                          key={message.id}
                          role="option" id={`global-search-option-${index}`} aria-selected={isSelected}
                          ref={(el) => {
                            if (el) rowRefs.current.set(index, el);
                            else rowRefs.current.delete(index);
                          }}
                          type="button"
                          className={`notion-search-row notion-search-message ${isSelected ? "is-selected" : ""}`}
                          onClick={() => onSelectMessage(message, term)}
                          onMouseEnter={() => setSelectedIndex(index)}
                        >
                          <div className="notion-search-message-top">
                            <div className="notion-search-message-location">
                              <span className="notion-search-pill-badge">{message.workspaceName}</span>
                              <span className="notion-search-channel-pill">#{message.channelName}</span>
                            </div>
                            <div className="notion-search-message-meta">
                              <strong className="notion-search-author">{message.authorName}</strong>
                              <span className="notion-search-dot">·</span>
                              <time dateTime={message.createdAt}>
                                {new Date(message.createdAt).toLocaleDateString("vi-VN", {
                                  day: "2-digit",
                                  month: "2-digit",
                                  year: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </time>
                            </div>
                          </div>
                          <div className="notion-search-message-content">
                            {message.content}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {hasMore && (
                    <div className="notion-search-more-wrap">
                      <button
                        type="button"
                        className="notion-search-more-btn"
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
                                ...items.filter((item) => !old.some((other) => other.id === item.id)),
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

              {/* Quick Navigation Pages */}
              {matchingPages.length > 0 && (
                <div className="notion-search-group">
                  <span className="notion-search-group-title">
                    {term.length >= 2 ? "TRANG PHÙ HỢP" : "ĐIỀU HƯỚNG NHANH"}
                  </span>
                  <div className="notion-search-pages-list">
                    {matchingPages.map((page, index) => {
                      const globalIndex = visibleResults.length + index;
                      const isSelected = selectedIndex === globalIndex;
                      return (
                        <button
                          key={page.id}
                          role="option" id={`global-search-option-${globalIndex}`} aria-selected={isSelected}
                          ref={(el) => {
                            if (el) rowRefs.current.set(globalIndex, el);
                            else rowRefs.current.delete(globalIndex);
                          }}
                          type="button"
                          className={`notion-search-row notion-search-page-row ${isSelected ? "is-selected" : ""}`}
                          onClick={() => onSelectView(page.id)}
                          onMouseEnter={() => setSelectedIndex(globalIndex)}
                        >
                          <div className="notion-search-page-icon">
                            <Icon name={page.icon} size={18} />
                          </div>
                          <div className="notion-search-page-info">
                            <span className="notion-search-page-title">{page.title}</span>
                            <span className="notion-search-page-desc">{page.desc}</span>
                          </div>
                          <div className="notion-search-page-action">
                            <span>Chuyển đến</span>
                            <Icon name="arrow-right" size={14} />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Empty hint when query < 2 */}
              {!loading && !error && term.length < 2 && (
                <div className="notion-search-tip">
                  <Icon name="sparkles" size={15} />
                  <span>Gợi ý: Nhập từ 2 ký tự trở lên để tìm kiếm sâu trong nội dung tin nhắn.</span>
                </div>
              )}
            </div>

            {/* Footer Bar */}
            <div className="notion-search-footer">
              <div className="notion-search-shortcuts">
                <span className="notion-search-shortcut">
                  <kbd>↑</kbd>
                  <kbd>↓</kbd>
                  <span>Di chuyển</span>
                </span>
                <span className="notion-search-shortcut">
                  <kbd>↵</kbd>
                  <span>Mở</span>
                </span>
                <span className="notion-search-shortcut">
                  <kbd>Esc</kbd>
                  <span>Đóng</span>
                </span>
              </div>
              <span className="notion-search-brand">nexo Quick Search</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
