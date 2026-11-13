/**
 * PROTOTYPE — throwaway. Answers "How do notifications look and feel in the app?"
 * (wayfinder ticket #5). Three structurally different variants, switchable via
 * `?variant=A|B|C` and the floating bar at the bottom of the screen. All state is
 * in memory (resets on reload); no Knock calls, no DB writes.
 *
 *   A — Prebuilt-style: bell in the sidebar header, popover feed. Mimics what
 *       Knock's <NotificationIconButton> + <NotificationFeedPopover> give out of
 *       the box (badge counts UNSEEN, opening marks all seen, "Powered by Knock").
 *   B — Custom drawer: "Inbox" nav item with an UNREAD count, right slide-over,
 *       Unread/All tabs, grouped by day, per-item read/unread + archive.
 *   C — Page + toasts: no dropdown. "Notifications" nav item with a dot, a full
 *       page at /prototype/notifications, and a toast when something arrives.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { NavLink, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import {
  Archive,
  Bell,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Inbox,
  MessageSquare,
  MessagesSquare,
  Plus,
  Settings,
  Trophy,
  X,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { UserRole } from "~/db/schema";

// ─── Data ────────────────────────────────────────────────────────────────────

export type Kind = "reply" | "new_thread" | "new_lesson" | "milestone_module" | "milestone_course";

export interface Notif {
  id: string;
  kind: Kind;
  actor?: { name: string; isInstructor?: boolean };
  /** Rendered line, per the copy table in the Notification Kinds ticket. */
  line: React.ReactNode;
  course: string;
  href: string;
  createdAt: number;
  seenAt: number | null;
  readAt: number | null;
  archivedAt: number | null;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const TS = "Introduction to TypeScript";
const TS_SLUG = "/courses/introduction-to-typescript";

function actorName(a: { name: string; isInstructor?: boolean }) {
  return (
    <>
      <strong>{a.name}</strong>
      {a.isInstructor && <span className="ml-1 rounded bg-primary/10 px-1 text-[10px] font-medium text-primary">Instructor</span>}
    </>
  );
}

function reply(id: string, ago: number, actor: Notif["actor"], lesson: string, lessonId: number, excerpt: string, read = false): Notif {
  const now = Date.now();
  return {
    id, kind: "reply", actor, course: TS,
    line: <>{actorName(actor!)} replied in a Thread on <em>{lesson}</em>: “{excerpt}”</>,
    href: `${TS_SLUG}/lessons/${lessonId}#comment-${id}`,
    createdAt: now - ago, seenAt: read ? now - ago : null, readAt: read ? now - ago : null, archivedAt: null,
  };
}

function newThread(id: string, ago: number, actor: Notif["actor"], lesson: string, lessonId: number, excerpt: string, read = false): Notif {
  const now = Date.now();
  return {
    id, kind: "new_thread", actor, course: TS,
    line: <>{actorName(actor!)} started a Thread on <em>{lesson}</em> in {TS}: “{excerpt}”</>,
    href: `${TS_SLUG}/lessons/${lessonId}#comment-${id}`,
    createdAt: now - ago, seenAt: read ? now - ago : null, readAt: read ? now - ago : null, archivedAt: null,
  };
}

function learnerFixtures(): Notif[] {
  const now = Date.now();
  return [
    reply("l1", 12 * MIN, { name: "Sarah Chen", isInstructor: true }, "Arrays and Tuples", 5,
      "Good question — a tuple is just an array with a fixed length and a type per position, so…"),
    {
      id: "l2", kind: "milestone_module", course: TS,
      line: <>You finished <strong>Getting Started with TypeScript</strong> in <em>{TS}</em>. Next up: Primitive Types</>,
      href: `${TS_SLUG}/lessons/4`, createdAt: now - 2 * HOUR, seenAt: null, readAt: null, archivedAt: null,
    },
    {
      id: "l3", kind: "new_lesson", course: TS,
      line: <>New lesson in <em>{TS}</em>: <strong>Type Aliases and Interfaces</strong></>,
      href: `${TS_SLUG}/lessons/6`, createdAt: now - 26 * HOUR, seenAt: now - 20 * HOUR, readAt: null, archivedAt: null,
    },
    reply("l4", 3 * DAY, { name: "James Park" }, "Your First TypeScript Program", 3,
      "Same here, I had to restart the TS server in VS Code before the error went away.", true),
    {
      id: "l5", kind: "milestone_course", course: "Design Systems with Tailwind",
      line: <>You finished <strong>Design Systems with Tailwind</strong>!</>,
      href: "/courses/design-systems-with-tailwind", createdAt: now - 8 * DAY, seenAt: now - 8 * DAY, readAt: now - 8 * DAY, archivedAt: null,
    },
  ];
}

function instructorFixtures(): Notif[] {
  return [
    newThread("i1", 4 * MIN, { name: "Emma Wilson" }, "Arrays and Tuples", 5,
      "When would I use a tuple instead of an object with named fields? The example felt a bit…"),
    reply("i2", 50 * MIN, { name: "Liam Thompson" }, "Primitive Types", 4,
      "Thanks! Follow-up: is `unknown` ever better than `any` for function params?"),
    newThread("i3", 5 * HOUR, { name: "Olivia Martinez" }, "Installing and Configuring TypeScript", 2,
      "The tsconfig in the video has `strict: false` but the repo has it true — which is right?"),
    newThread("i4", 2 * DAY, { name: "James Park" }, "What is TypeScript?", 1,
      "Loved the intro. Is there a recommended book to read alongside the course?", true),
    reply("i5", 4 * DAY, { name: "Emma Wilson" }, "Primitive Types", 4,
      "That fixed it, thank you!", true),
  ];
}

let simCounter = 0;
function simulated(role: UserRole | null): Notif {
  simCounter++;
  const id = `sim${simCounter}`;
  const learners = ["Emma Wilson", "James Park", "Olivia Martinez", "Liam Thompson"];
  const who = learners[simCounter % learners.length];
  if (role === UserRole.Learner) {
    return simCounter % 2
      ? reply(id, 0, { name: who }, "Arrays and Tuples", 5, `Simulated reply #${simCounter} — I think the trick is to read the error from the bottom up.`)
      : { id, kind: "new_lesson", course: TS, line: <>New lesson in <em>{TS}</em>: <strong>Simulated Lesson {simCounter}</strong></>,
          href: `${TS_SLUG}/lessons/6`, createdAt: Date.now(), seenAt: null, readAt: null, archivedAt: null };
  }
  return simCounter % 2
    ? newThread(id, 0, { name: who }, "Type Aliases and Interfaces", 6, `Simulated Thread #${simCounter} — when should I pick an interface over a type alias?`)
    : reply(id, 0, { name: who }, "Primitive Types", 4, `Simulated reply #${simCounter} — that makes sense now, thanks.`);
}

// ─── Store ───────────────────────────────────────────────────────────────────

interface Store {
  items: Notif[];
  markSeenAll(): void;
  markRead(id: string): void;
  markUnread(id: string): void;
  markAllRead(): void;
  archive(id: string): void;
  simulate(): void;
  role: UserRole | null;
  variant: string;
}

const Ctx = createContext<Store | null>(null);

export function useNotifs() {
  const s = useContext(Ctx);
  if (!s) throw new Error("NotificationsPrototypeProvider missing");
  return s;
}

export function NotificationsPrototypeProvider({ role, userId, children }: { role: UserRole | null; userId: number | null; children: React.ReactNode }) {
  const [items, setItems] = useState<Notif[]>([]);
  // Variant lives here so it survives sidebar navigation (which drops ?variant=).
  const [params] = useSearchParams();
  const urlVariant = params.get("variant");
  const [variant, setVariant] = useState("A");
  useEffect(() => {
    if (urlVariant && VARIANTS.some((x) => x.key === urlVariant)) setVariant(urlVariant);
  }, [urlVariant]);
  useEffect(() => {
    setItems(role === UserRole.Learner ? learnerFixtures() : role ? instructorFixtures() : []);
  }, [role, userId]);

  const patch = useCallback((fn: (n: Notif) => Notif) => setItems((xs) => xs.map(fn)), []);
  const store = useMemo<Store>(() => ({
    items, role, variant,
    markSeenAll: () => patch((n) => (n.seenAt ? n : { ...n, seenAt: Date.now() })),
    markRead: (id) => patch((n) => (n.id === id ? { ...n, seenAt: n.seenAt ?? Date.now(), readAt: n.readAt ?? Date.now() } : n)),
    markUnread: (id) => patch((n) => (n.id === id ? { ...n, readAt: null } : n)),
    markAllRead: () => patch((n) => ({ ...n, seenAt: n.seenAt ?? Date.now(), readAt: n.readAt ?? Date.now() })),
    archive: (id) => patch((n) => (n.id === id ? { ...n, archivedAt: Date.now() } : n)),
    simulate: () => setItems((xs) => [simulated(role), ...xs]),
  }), [items, role, variant, patch]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

const live = (xs: Notif[]) => xs.filter((n) => !n.archivedAt);
const unseenCount = (xs: Notif[]) => live(xs).filter((n) => !n.seenAt).length;
const unreadCount = (xs: Notif[]) => live(xs).filter((n) => !n.readAt).length;

export function usePrototypeVariant() {
  return useNotifs().variant;
}

// ─── Shared bits ─────────────────────────────────────────────────────────────

function ago(ts: number) {
  const d = Date.now() - ts;
  if (d < MIN) return "just now";
  if (d < HOUR) return `${Math.floor(d / MIN)}m`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h`;
  return `${Math.floor(d / DAY)}d`;
}

const KIND_META: Record<Kind, { label: string; icon: React.ReactNode; tint: string }> = {
  reply: { label: "Reply", icon: <MessageSquare className="size-4" />, tint: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  new_thread: { label: "New Thread", icon: <MessagesSquare className="size-4" />, tint: "bg-violet-500/10 text-violet-600 dark:text-violet-400" },
  new_lesson: { label: "New Lesson", icon: <BookOpen className="size-4" />, tint: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  milestone_module: { label: "Milestone", icon: <Trophy className="size-4" />, tint: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  milestone_course: { label: "Milestone", icon: <Trophy className="size-4" />, tint: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
};

function Initials({ name }: { name: string }) {
  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
      {name.split(" ").map((p) => p[0]).join("").slice(0, 2)}
    </div>
  );
}

function useOpen(onOpen?: () => void) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    onOpen?.();
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return { open, setOpen, ref };
}

// ─── Variant A: prebuilt-style bell + popover ────────────────────────────────

/** Mounted in the sidebar header, beside the "Cadence" wordmark. */
export function VariantABell() {
  const s = useNotifs();
  const navigate = useNavigate();
  const { open, setOpen, ref } = useOpen(s.markSeenAll); // Knock default: opening marks all seen
  const [filter, setFilter] = useState<"all" | "unread" | "read">("all");
  const badge = unseenCount(s.items);
  const shown = live(s.items).filter((n) => filter === "all" || (filter === "unread" ? !n.readAt : !!n.readAt));

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} className="relative rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent" title="Notifications">
        <Bell className="size-5" />
        {badge > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-4 text-white">{badge}</span>
        )}
      </button>
      {open && (
        <div className="absolute left-full top-0 z-40 ml-3 w-96 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="font-semibold">Notifications</span>
              <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="rounded border bg-transparent px-1 py-0.5 text-xs">
                <option value="all">All</option><option value="unread">Unread</option><option value="read">Read</option>
              </select>
            </div>
            <button onClick={s.markAllRead} className="text-xs text-primary hover:underline">Mark all as read</button>
          </div>
          <div className="max-h-[28rem] overflow-y-auto">
            {shown.length === 0 && <div className="p-8 text-center text-sm text-muted-foreground">No notifications yet<br />We'll let you know when we've got something new for you.</div>}
            {shown.map((n) => (
              <button
                key={n.id}
                onClick={() => { s.markRead(n.id); setOpen(false); navigate(n.href); }}
                className="flex w-full gap-3 border-b px-4 py-3 text-left text-sm last:border-0 hover:bg-muted/50"
              >
                <span className={cn("mt-3 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-blue-500")} />
                {n.actor ? <Initials name={n.actor.name} /> : <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", KIND_META[n.kind].tint)}>{KIND_META[n.kind].icon}</div>}
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-3">{n.line}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{ago(n.createdAt)}</div>
                </div>
              </button>
            ))}
          </div>
          <div className="border-t bg-muted/30 py-1.5 text-center text-[11px] text-muted-foreground">Powered by <strong>Knock</strong></div>
        </div>
      )}
    </div>
  );
}

// ─── Variant B: custom Inbox drawer ──────────────────────────────────────────

/** Mounted as a nav item in the sidebar. */
export function VariantBInbox() {
  const s = useNotifs();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"unread" | "all">("unread");
  const count = unreadCount(s.items);
  const shown = live(s.items).filter((n) => tab === "all" || !n.readAt);
  const today = shown.filter((n) => Date.now() - n.createdAt < DAY);
  const earlier = shown.filter((n) => Date.now() - n.createdAt >= DAY);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open]);

  const Row = ({ n }: { n: Notif }) => (
    <div className={cn("group relative flex gap-3 rounded-lg p-3 text-sm", n.readAt ? "opacity-70" : "bg-primary/5")}>
      <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", KIND_META[n.kind].tint)}>{KIND_META[n.kind].icon}</div>
      <button className="min-w-0 flex-1 text-left" onClick={() => { s.markRead(n.id); setOpen(false); navigate(n.href); }}>
        <div className="mb-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium">{KIND_META[n.kind].label}</span>·<span className="truncate">{n.course}</span>·<span>{ago(n.createdAt)}</span>
        </div>
        <div className="line-clamp-2">{n.line}</div>
      </button>
      <div className="absolute right-2 top-2 hidden gap-1 rounded-md border bg-background p-0.5 shadow-sm group-hover:flex">
        <button title={n.readAt ? "Mark unread" : "Mark read"} onClick={() => (n.readAt ? s.markUnread(n.id) : s.markRead(n.id))} className="rounded p-1 hover:bg-muted">
          {n.readAt ? <span className="block size-3.5 rounded-full border-2 border-blue-500" /> : <Check className="size-3.5" />}
        </button>
        <button title="Archive" onClick={() => s.archive(n.id)} className="rounded p-1 hover:bg-muted"><Archive className="size-3.5" /></button>
      </div>
    </div>
  );

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <Inbox className="size-4" />
        Inbox
        {count > 0 && <span className="ml-auto rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-5 text-primary-foreground">{count}</span>}
      </button>
      {open && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/20" onClick={() => setOpen(false)}>
          <aside className="flex h-full w-[26rem] flex-col border-l bg-background shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h2 className="text-lg font-semibold">Inbox</h2>
              <div className="flex items-center gap-1">
                <button onClick={s.markAllRead} className="rounded-md px-2 py-1 text-xs font-medium hover:bg-muted">Mark all read</button>
                <button onClick={() => setOpen(false)} className="rounded-md p-1 hover:bg-muted"><X className="size-4" /></button>
              </div>
            </div>
            <div className="flex gap-1 border-b px-5 py-2">
              {(["unread", "all"] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)} className={cn("rounded-md px-3 py-1 text-sm capitalize", tab === t ? "bg-muted font-medium" : "text-muted-foreground")}>
                  {t}{t === "unread" && count > 0 ? ` (${count})` : ""}
                </button>
              ))}
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-3">
              {shown.length === 0 && <div className="mt-16 text-center text-sm text-muted-foreground">You're all caught up.</div>}
              {today.length > 0 && <section><h3 className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Today</h3>{today.map((n) => <Row key={n.id} n={n} />)}</section>}
              {earlier.length > 0 && <section><h3 className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Earlier</h3>{earlier.map((n) => <Row key={n.id} n={n} />)}</section>}
            </div>
            <NavLink to="/settings" onClick={() => setOpen(false)} className="flex items-center gap-2 border-t px-5 py-3 text-sm text-muted-foreground hover:text-foreground">
              <Settings className="size-4" /> Notification settings
            </NavLink>
          </aside>
        </div>
      )}
    </>
  );
}

// ─── Variant C: full page + toasts ───────────────────────────────────────────

/** Mounted as a nav item in the sidebar; also fires toasts for new arrivals. */
export function VariantCNavItem() {
  const s = useNotifs();
  const navigate = useNavigate();
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (known.current === null || s.items.length === 0) { known.current = new Set(s.items.map((n) => n.id)); return; }
    for (const n of s.items) {
      if (known.current.has(n.id)) continue;
      known.current.add(n.id);
      toast(<div className="text-sm">{n.line}</div>, {
        icon: KIND_META[n.kind].icon,
        action: { label: "View", onClick: () => { s.markRead(n.id); navigate(n.href); } },
      });
    }
  }, [s.items, s, navigate]);
  const hasUnread = unreadCount(s.items) > 0;
  return (
    <NavLink
      to="/prototype/notifications?variant=C"
      className={({ isActive }) => cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        isActive ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      )}
    >
      <Bell className="size-4" /> Notifications
      {hasUnread && <span className="ml-auto size-2 rounded-full bg-red-500" />}
    </NavLink>
  );
}

export function VariantCPage() {
  const s = useNotifs();
  const navigate = useNavigate();
  const [kind, setKind] = useState<"all" | "comments" | "lessons" | "milestones">("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  useEffect(() => { s.markSeenAll(); /* viewing the page = seen */ }, [s.items.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const match = (n: Notif) =>
    kind === "all" ||
    (kind === "comments" && (n.kind === "reply" || n.kind === "new_thread")) ||
    (kind === "lessons" && n.kind === "new_lesson") ||
    (kind === "milestones" && n.kind.startsWith("milestone"));
  const shown = live(s.items).filter((n) => match(n) && (!unreadOnly || !n.readAt));
  const byCourse = shown.reduce<Record<string, Notif[]>>((acc, n) => ((acc[n.course] ??= []).push(n), acc), {});

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="text-sm text-muted-foreground">{unreadCount(s.items)} unread</p>
        </div>
        <div className="flex gap-2">
          <button onClick={s.markAllRead} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">Mark all read</button>
          <NavLink to="/settings" className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">Preferences</NavLink>
        </div>
      </div>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {(["all", "comments", "lessons", "milestones"] as const).map((k) => (
          <button key={k} onClick={() => setKind(k)} className={cn("rounded-full border px-3 py-1 text-sm capitalize", kind === k && "border-primary bg-primary text-primary-foreground")}>{k}</button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-sm"><input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Unread only</label>
      </div>
      {shown.length === 0 && <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">Nothing here.</div>}
      <div className="space-y-8">
        {Object.entries(byCourse).map(([course, ns]) => (
          <section key={course}>
            <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{course}</h2>
            <div className="divide-y rounded-lg border">
              {ns.map((n) => (
                <div key={n.id} className="flex items-start gap-4 p-4">
                  <div className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full", KIND_META[n.kind].tint)}>{KIND_META[n.kind].icon}</div>
                  <div className="min-w-0 flex-1">
                    <div className={cn("text-sm", !n.readAt && "font-medium")}>{n.line}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{KIND_META[n.kind].label} · {ago(n.createdAt)} ago</div>
                  </div>
                  <button onClick={() => { s.markRead(n.id); navigate(n.href); }} className="shrink-0 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                    {n.kind === "reply" ? "View reply" : n.kind === "new_thread" ? "Reply" : n.kind === "new_lesson" ? "Watch now" : n.kind === "milestone_module" ? "Keep going" : "See your course"}
                  </button>
                  {!n.readAt && <span className="mt-2 size-2 shrink-0 rounded-full bg-blue-500" />}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

// ─── Floating switcher ───────────────────────────────────────────────────────

const VARIANTS = [
  { key: "A", name: "Prebuilt-style bell + popover" },
  { key: "B", name: "Custom Inbox drawer" },
  { key: "C", name: "Page + toasts" },
];

export function PrototypeSwitcher() {
  const s = useNotifs();
  const current = usePrototypeVariant();
  const [params, setParams] = useSearchParams();
  const [showState, setShowState] = useState(false);
  const idx = VARIANTS.findIndex((v) => v.key === current);
  const go = useCallback((d: number) => {
    const next = VARIANTS[(idx + d + VARIANTS.length) % VARIANTS.length].key;
    const p = new URLSearchParams(params);
    p.set("variant", next);
    setParams(p, { replace: true, preventScrollReset: true });
  }, [idx, params, setParams]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  if (process.env.NODE_ENV === "production") return null;
  const l = live(s.items);

  return (
    <div className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2">
      {showState && (
        <div className="mb-2 max-h-64 w-[34rem] overflow-y-auto rounded-lg bg-zinc-900 p-3 font-mono text-[11px] text-zinc-100 shadow-2xl">
          {s.items.map((n) => (
            <div key={n.id} className={cn("flex gap-2", n.archivedAt && "line-through opacity-50")}>
              <span className="w-10">{n.id}</span><span className="w-32">{n.kind}</span>
              <span className={n.seenAt ? "text-zinc-500" : "text-yellow-300"}>{n.seenAt ? "seen" : "UNSEEN"}</span>
              <span className={n.readAt ? "text-zinc-500" : "text-sky-300"}>{n.readAt ? "read" : "UNREAD"}</span>
              <span className="truncate text-zinc-400">{n.href}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mx-auto flex w-fit items-center gap-1 rounded-full bg-zinc-900 px-2 py-1.5 text-sm text-white shadow-2xl ring-2 ring-yellow-400">
        <button onClick={() => go(-1)} className="rounded-full p-1 hover:bg-white/10"><ChevronLeft className="size-4" /></button>
        <span className="px-2 font-medium">{current} <span className="text-zinc-400">({VARIANTS[idx].name})</span></span>
        <button onClick={() => go(1)} className="rounded-full p-1 hover:bg-white/10"><ChevronRight className="size-4" /></button>
        <span className="mx-1 h-4 w-px bg-white/20" />
        <button onClick={s.simulate} className="flex items-center gap-1 rounded-full px-2 py-0.5 hover:bg-white/10" title="Simulate an incoming notification"><Plus className="size-3.5" />new</button>
        <button onClick={() => setShowState(!showState)} className="rounded-full px-2 py-0.5 font-mono text-xs hover:bg-white/10" title="Show state">
          unseen {unseenCount(s.items)} · unread {unreadCount(s.items)} · {l.length}
        </button>
      </div>
    </div>
  );
}
