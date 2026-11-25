import { useState } from "react";
import { cn } from "../../lib/utils";

/** A round avatar: the photo, or the initials of the first and last word of the name. */
export function UserAvatar({
  name,
  image,
  online = false,
  group = false,
  className,
}: {
  name: string;
  image?: string;
  /** Shows the green presence dot. */
  online?: boolean;
  /** Groups get the neutral tone, people the accent one. */
  group?: boolean;
  /** Size and text size, e.g. "size-9 text-xs". */
  className?: string;
}) {
  // Remote photos (e.g. expired Google URLs) fall back to initials instead of a broken image.
  const [failedImage, setFailedImage] = useState<string | null>(null);
  // Words like "(test)" or "-" would give "L(" or "P-"; only letters and digits start initials.
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => /^[\p{L}\p{N}]/u.test(word));
  const initials = (words.length > 1 ? [words[0], words[words.length - 1]] : words)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
  return (
    <span
      className={cn(
        "relative grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold",
        group ? "bg-secondary text-foreground" : "bg-brand-soft text-brand",
        className,
      )}
      title={name}
    >
      {image && failedImage !== image ? (
        <img
          src={image}
          alt=""
          referrerPolicy="no-referrer"
          className="size-full rounded-full object-cover"
          onError={() => setFailedImage(image)}
        />
      ) : (
        initials || "?"
      )}
      {online && (
        <span
          className="absolute right-0 bottom-0 size-[11px] rounded-full bg-emerald-500 ring-2 ring-background"
          role="img"
          aria-label="Đang hoạt động"
        />
      )}
    </span>
  );
}
