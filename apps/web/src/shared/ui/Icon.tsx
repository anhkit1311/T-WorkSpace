import type { SVGProps } from "react";
import {
  Activity,
  ArrowDownUp,
  ArrowRight,
  Bell,
  BookOpen,
  Bookmark,
  Pin,
  CalendarDays,
  Camera,
  CameraOff,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  CircleHelp,
  Clock3,
  Command,
  Ellipsis,
  Eye,
  FileText,
  Folder,
  Grid2X2,
  Hand,
  Headset,
  House,
  Info,
  LayoutDashboard,
  LayoutGrid,
  Link2,
  ListFilter,
  ListTodo,
  LockKeyhole,
  LogOut,
  Mail,
  Menu,
  MessagesSquare,
  Mic,
  MicOff,
  Minus,
  Monitor,
  Moon,
  Orbit,
  PanelLeft,
  Paperclip,
  Phone,
  Play,
  Plus,
  Search,
  Send,
  Settings2,
  Share2,
  ShieldCheck,
  Sparkles,
  SquareCheck,
  Star,
  Sun,
  Upload,
  UserRoundPlus,
  UserRound,
  UsersRound,
  Video,
  Wifi,
  X,
  Zap,
  Download,
  Heart,
  Image as ImageIcon,
  Pencil,
  Smile,
  ThumbsUp,
  SquarePen,
  EllipsisVertical,
  MessageSquareMore,
  type LucideIcon,
} from "lucide-react";

export type IconName =
  | "activity"
  | "admin"
  | "arrow-right"
  | "arrow-up-down"
  | "bell"
  | "book"
  | "bookmark"
  | "pin"
  | "calendar"
  | "camera"
  | "camera-off"
  | "check"
  | "check-square"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "chevron-up"
  | "clock"
  | "command"
  | "dashboard"
  | "eye"
  | "file"
  | "filter"
  | "folder"
  | "grid"
  | "grid-2x2"
  | "hand"
  | "headset"
  | "help"
  | "help-circle"
  | "home"
  | "info"
  | "link"
  | "lock"
  | "logout"
  | "mail"
  | "menu"
  | "message"
  | "mic"
  | "mic-off"
  | "minus"
  | "monitor"
  | "moon"
  | "more"
  | "paperclip"
  | "phone"
  | "play"
  | "plus"
  | "record"
  | "search"
  | "send"
  | "settings"
  | "share"
  | "sparkles"
  | "split"
  | "star"
  | "sun"
  | "tasks"
  | "upload"
  | "user-plus"
  | "users"
  | "video"
  | "wifi"
  | "x"
  | "zap"
  | "orbit"
  | "profile"
  | "messages"
  | "download"
  | "heart"
  | "image"
  | "edit"
  | "pencil"
  | "smile"
  | "thumbs-up";

const icons = {
  activity: Activity,
  admin: ShieldCheck,
  "arrow-right": ArrowRight,
  "arrow-up-down": ArrowDownUp,
  bell: Bell,
  book: BookOpen,
  bookmark: Bookmark,
  pin: Pin,
  calendar: CalendarDays,
  camera: Camera,
  "camera-off": CameraOff,
  check: Check,
  "check-square": SquareCheck,
  "chevron-down": ChevronDown,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  "chevron-up": ChevronUp,
  clock: Clock3,
  command: Command,
  dashboard: LayoutDashboard,
  eye: Eye,
  file: FileText,
  filter: ListFilter,
  folder: Folder,
  grid: LayoutGrid,
  "grid-2x2": Grid2X2,
  hand: Hand,
  headset: Headset,
  help: CircleHelp,
  "help-circle": CircleHelp,
  home: House,
  info: Info,
  link: Link2,
  lock: LockKeyhole,
  logout: LogOut,
  mail: Mail,
  menu: Menu,
  message: MessageSquareMore,
  mic: Mic,
  "mic-off": MicOff,
  minus: Minus,
  monitor: Monitor,
  moon: Moon,
  more: EllipsisVertical,
  paperclip: Paperclip,
  phone: Phone,
  play: Play,
  plus: Plus,
  record: Circle,
  search: Search,
  send: Send,
  settings: Settings2,
  share: Share2,
  sparkles: Sparkles,
  split: PanelLeft,
  star: Star,
  sun: Sun,
  tasks: ListTodo,
  upload: Upload,
  "user-plus": UserRoundPlus,
  users: UsersRound,
  video: Video,
  wifi: Wifi,
  x: X,
  zap: Zap,
  orbit: Orbit,
  profile: UserRound,
  messages: MessagesSquare,
  download: Download,
  heart: Heart,
  image: ImageIcon,
  edit: SquarePen,
  pencil: SquarePen,
  smile: Smile,
  "thumbs-up": ThumbsUp,
} satisfies Record<IconName, LucideIcon>;

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 18, ...props }: IconProps) {
  const Glyph = icons[name];
  return <Glyph aria-hidden="true" size={size} strokeWidth={1.8} absoluteStrokeWidth {...props} />;
}
