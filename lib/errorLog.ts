// In-app error capture. Buffers every JS-catchable failure — uncaught errors,
// unhandled promise rejections, and console.error calls — into a rolling log
// that the on-screen <ErrorOverlay> subscribes to.
//
// IMPORTANT: this cannot catch native crashes (SIGSEGV/SIGABRT). Those kill the
// process before any JS runs — e.g. the Hermes-GC crash from an NSException
// thrown by a native TurboModule void method. It DOES catch that same NSException
// on the (intermittent) occasions RN converts it to a JS error without crashing,
// so it still helps identify the offending module. For true native crashes, use
// a native crash reporter (Sentry/Crashlytics) that reports on the next launch.

export interface AppError {
  id:      number;
  when:    string;   // HH:MM:SS
  kind:    "error" | "unhandledRejection" | "console";
  message: string;
  stack:   string | null;
}

type Listener = (errors: AppError[]) => void;

let buffer: AppError[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit() {
  const snapshot = buffer;
  listeners.forEach(l => l(snapshot));
}

function push(kind: AppError["kind"], message: string, stack: string | null) {
  const entry: AppError = {
    id:   nextId++,
    when: new Date().toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    kind,
    message,
    stack,
  };
  // Newest first, keep the last 25.
  buffer = [entry, ...buffer].slice(0, 25);
  emit();
}

export function reportError(e: unknown, kind: AppError["kind"] = "error") {
  if (e instanceof Error) push(kind, e.message || String(e), e.stack ?? null);
  else push(kind, typeof e === "string" ? e : JSON.stringify(e), null);
}

export function clearErrors() {
  buffer = [];
  emit();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  listener(buffer);
  return () => { listeners.delete(listener); };
}

// Install once, as early as possible in app startup.
let installed = false;
export function installErrorHandlers() {
  if (installed) return;
  installed = true;

  // 1. Uncaught JS errors (including fatal). ErrorUtils is a RN global.
  const g = globalThis as unknown as {
    ErrorUtils?: {
      getGlobalHandler?: () => (e: unknown, isFatal?: boolean) => void;
      setGlobalHandler: (h: (e: unknown, isFatal?: boolean) => void) => void;
    };
    HermesInternal?: unknown;
  };
  const prev = g.ErrorUtils?.getGlobalHandler?.();
  g.ErrorUtils?.setGlobalHandler?.((e, isFatal) => {
    reportError(e, "error");
    // Preserve RN's default handling (red box in dev, etc.).
    prev?.(e, isFatal);
  });

  // 2. Unhandled promise rejections.
  const gp = globalThis as unknown as {
    addEventListener?: (t: string, cb: (ev: any) => void) => void;
  };
  gp.addEventListener?.("unhandledrejection", (ev: any) => {
    reportError(ev?.reason ?? ev, "unhandledRejection");
  });

  // 3. Mirror console.error into the overlay so warnings we log ourselves show up.
  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const first = args[0];
    // Skip React's internal dev warnings noise; keep real error objects/messages.
    push("console", args.map(a => (a instanceof Error ? a.message : String(a))).join(" "),
      first instanceof Error ? first.stack ?? null : null);
    origError(...args);
  };
}
