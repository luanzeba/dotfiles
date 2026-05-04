import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

type TaskState = "inbox" | "ready" | "waiting" | "in_progress" | "done";
type TaskLane = "now" | "today" | "if_time" | null;

type Task = {
  id: number;
  title: string;
  details?: string;
  state: TaskState;
  lane: TaskLane;
  owner?: string;
};

type ExecResult = {
  stdout?: string;
  stderr?: string;
  code?: number;
};

type MoveTarget = "now" | "today" | "if_time" | "inbox" | "waiting";

type DashboardAction =
  | { type: "exit" }
  | { type: "refresh"; selectedId?: number }
  | { type: "add"; selectedId?: number }
  | { type: "move"; id: number; target: MoveTarget; selectedId?: number }
  | { type: "done"; id: number; selectedId?: number }
  | { type: "assign"; id: number; selectedId?: number }
  | { type: "delete"; id: number; selectedId?: number };

type BoardSection = {
  key: "now" | "today" | "if_time" | "inbox" | "waiting";
  title: string;
  tasks: Task[];
};

type BoardData = {
  sections: BoardSection[];
  done: Task[];
  selectable: Task[];
};

const assignModes = ["research", "implement", "review", "draft"] as const;

function isLaneTarget(target: MoveTarget): target is "now" | "today" | "if_time" {
  return target === "now" || target === "today" || target === "if_time";
}

function buildBoard(tasks: Task[]): BoardData {
  const now = tasks.filter((t) => t.lane === "now" && t.state === "in_progress");
  const today = tasks.filter((t) => t.lane === "today" && t.state === "ready");
  const ifTime = tasks.filter((t) => t.lane === "if_time" && t.state === "ready");
  const inbox = tasks.filter((t) => t.state === "inbox");
  const waiting = tasks.filter((t) => t.state === "waiting");
  const done = tasks.filter((t) => t.state === "done");

  const sections: BoardSection[] = [
    { key: "now", title: "NOW", tasks: now },
    { key: "today", title: "TODAY", tasks: today },
    { key: "if_time", title: "IF_TIME", tasks: ifTime },
    { key: "inbox", title: "INBOX", tasks: inbox },
    { key: "waiting", title: "WAITING", tasks: waiting },
  ];

  return {
    sections,
    done,
    selectable: [...now, ...today, ...ifTime, ...inbox, ...waiting],
  };
}

function padToWidth(text: string, width: number): string {
  const clipped = truncateToWidth(text, width);
  const remaining = Math.max(0, width - visibleWidth(clipped));
  return `${clipped}${" ".repeat(remaining)}`;
}

export default function (pi: ExtensionAPI) {
  async function execTodo(args: string[], ctx: ExtensionCommandContext): Promise<string> {
    const candidateBinaries = [
      process.env.TODO_CLI_PATH,
      `${ctx.cwd}/zig-out/bin/todo`,
      "/Users/luan/projects/todo/zig-out/bin/todo",
      "todo",
    ].filter((value): value is string => Boolean(value));

    let lastError = "todo command failed";

    for (const bin of candidateBinaries) {
      const result = (await pi.exec(bin, args, { timeout: 15_000 }).catch(() => null)) as ExecResult | null;
      if (!result) continue;
      if ((result.code ?? 1) === 0) return result.stdout ?? "";
      lastError = result.stderr || result.stdout || lastError;
    }

    throw new Error(lastError);
  }

  async function listAll(ctx: ExtensionCommandContext): Promise<Task[]> {
    const output = await execTodo(["--json", "list", "--all"], ctx);
    const parsed = JSON.parse(output) as unknown;
    return Array.isArray(parsed) ? (parsed as Task[]) : [];
  }

  async function moveTask(ctx: ExtensionCommandContext, id: number, target: MoveTarget): Promise<void> {
    if (isLaneTarget(target)) {
      await execTodo(["edit", String(id), "--lane", target], ctx);
      return;
    }

    await execTodo(["edit", String(id), "--state", target], ctx);
  }

  async function assignTask(
    ctx: ExtensionCommandContext,
    id: number,
    mode: (typeof assignModes)[number],
  ): Promise<void> {
    const metadata = JSON.stringify({ pi_mode: mode });
    await execTodo([
      "edit",
      String(id),
      "--owner",
      "pi",
      "--state",
      "waiting",
      "--metadata-json",
      metadata,
    ], ctx);
  }

  async function openDashboard(ctx: ExtensionCommandContext): Promise<void> {
    if (!ctx.hasUI) {
      ctx.ui.notify("todo dashboard requires interactive UI", "warning");
      return;
    }

    let selectedId: number | undefined;

    while (true) {
      const tasks = await listAll(ctx);
      const board = buildBoard(tasks);

      if (board.selectable.length === 0) {
        selectedId = undefined;
      } else if (!selectedId || !board.selectable.some((t) => t.id === selectedId)) {
        selectedId = board.selectable[0].id;
      }

      const action = await ctx.ui.custom<DashboardAction | null>(
        (tui, theme, _keybindings, done) => {
          let selectedIndex = board.selectable.findIndex((t) => t.id === selectedId);
          if (selectedIndex < 0) selectedIndex = board.selectable.length > 0 ? 0 : -1;

          const currentTask = () =>
            selectedIndex >= 0 && selectedIndex < board.selectable.length ? board.selectable[selectedIndex] : undefined;

          const getSelectedId = () => currentTask()?.id;

          const moveSelection = (delta: number) => {
            if (board.selectable.length === 0) return;
            selectedIndex = (selectedIndex + delta + board.selectable.length) % board.selectable.length;
            tui.requestRender();
          };

          const commitAction = (actionOut: DashboardAction) => done(actionOut);

          return {
            render(width: number): string[] {
              const count = Object.fromEntries(board.sections.map((s) => [s.key, s.tasks.length])) as Record<
                BoardSection["key"],
                number
              >;

              const selectedTaskId = getSelectedId();

              const panelWidth = Math.max(32, Math.min(width, width - 2));
              const innerWidth = Math.max(20, panelWidth - 4);
              const fullPanelWidth = innerWidth + 4;
              const margin = " ".repeat(Math.max(0, Math.floor((width - fullPanelWidth) / 2)));
              const horizontal = "─".repeat(Math.max(1, innerWidth + 2));

              const lines: string[] = [];

              const pushPanelLine = (raw = "") => {
                const padded = padToWidth(raw, innerWidth);
                lines.push(`${margin}│ ${padded} │`);
              };

              lines.push(`${margin}┌${horizontal}┐`);
              pushPanelLine(theme.fg("accent", theme.bold("TODO Dashboard")));
              pushPanelLine(
                `NOW ${count.now} · TODAY ${count.today} · IF_TIME ${count.if_time} · INBOX ${count.inbox} · WAITING ${count.waiting} · DONE ${board.done.length}`,
              );
              pushPanelLine(
                theme.fg("dim", "n/t/i/b/w move · d done · a assign · c capture · x delete · r refresh · esc quit"),
              );
              pushPanelLine("");

              for (const section of board.sections) {
                pushPanelLine(theme.fg("accent", theme.bold(`${section.title} (${section.tasks.length})`)));

                if (section.tasks.length === 0) {
                  pushPanelLine(theme.fg("dim", "  ·"));
                  pushPanelLine("");
                  continue;
                }

                for (const task of section.tasks) {
                  const selected = task.id === selectedTaskId;
                  const ownerSuffix = task.owner === "pi" ? " · pi" : "";
                  const base = `${selected ? "›" : " "} #${task.id} ${task.title}${ownerSuffix}`;
                  pushPanelLine(selected ? theme.fg("accent", theme.bold(base)) : base);
                }

                pushPanelLine("");
              }

              if (board.done.length > 0) {
                pushPanelLine(theme.fg("dim", `DONE PREVIEW (${board.done.length})`));
                for (const task of board.done.slice(0, 3)) {
                  pushPanelLine(theme.fg("dim", `  #${task.id} ${task.title}`));
                }
                pushPanelLine("");
              }

              lines.push(`${margin}└${horizontal}┘`);

              return lines.map((line) => theme.bg("toolPendingBg", padToWidth(line, width)));
            },

            invalidate() {},

            handleInput(data: string) {
              if (matchesKey(data, Key.up)) {
                moveSelection(-1);
                return;
              }

              if (matchesKey(data, Key.down)) {
                moveSelection(1);
                return;
              }

              if (matchesKey(data, Key.escape) || data === "q") {
                commitAction({ type: "exit" });
                return;
              }

              if (data === "r") {
                commitAction({ type: "refresh", selectedId: getSelectedId() });
                return;
              }

              if (data === "c") {
                commitAction({ type: "add", selectedId: getSelectedId() });
                return;
              }

              const task = currentTask();
              if (!task) return;

              if (data === "n") {
                commitAction({ type: "move", id: task.id, target: "now", selectedId: task.id });
                return;
              }
              if (data === "t") {
                commitAction({ type: "move", id: task.id, target: "today", selectedId: task.id });
                return;
              }
              if (data === "i") {
                commitAction({ type: "move", id: task.id, target: "if_time", selectedId: task.id });
                return;
              }
              if (data === "b") {
                commitAction({ type: "move", id: task.id, target: "inbox", selectedId: task.id });
                return;
              }
              if (data === "w") {
                commitAction({ type: "move", id: task.id, target: "waiting", selectedId: task.id });
                return;
              }
              if (data === "d") {
                commitAction({ type: "done", id: task.id, selectedId: task.id });
                return;
              }
              if (data === "a") {
                commitAction({ type: "assign", id: task.id, selectedId: task.id });
                return;
              }
              if (data === "x") {
                commitAction({ type: "delete", id: task.id, selectedId: task.id });
              }
            },
          };
        },
      );

      if (!action || action.type === "exit") break;
      if (action.selectedId) selectedId = action.selectedId;

      try {
        switch (action.type) {
          case "refresh":
            break;

          case "add": {
            const title = await ctx.ui.input("Capture task", "What needs to get done?");
            if (title && title.trim().length > 0) {
              await execTodo(["create", title.trim()], ctx);
              ctx.ui.notify("task added", "info");
            }
            break;
          }

          case "move": {
            await moveTask(ctx, action.id, action.target);
            break;
          }

          case "done": {
            await execTodo(["done", String(action.id)], ctx);
            break;
          }

          case "assign": {
            const selected = await ctx.ui.select("Assign to Pi mode", [...assignModes]);
            if (selected) {
              await assignTask(ctx, action.id, selected as (typeof assignModes)[number]);
            }
            break;
          }

          case "delete": {
            const ok = await ctx.ui.confirm("Delete task", `Delete task #${action.id}?`);
            if (ok) {
              await execTodo(["delete", String(action.id)], ctx);
            }
            break;
          }

          default:
            break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`todo action failed: ${message}`, "error");
      }
    }

  }

  pi.registerCommand("todo", {
    description: "Open interactive todo dashboard",
    handler: async (_args, ctx) => {
      await openDashboard(ctx);
    },
  });
}
