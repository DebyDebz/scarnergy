import { isIgnoredError, reportError, clearErrors, subscribe, AppError } from "../lib/errorLog";

describe("isIgnoredError", () => {
  it("ignores benign auth-session errors", () => {
    expect(isIgnoredError("Invalid Refresh Token: Refresh Token Not Found")).toBe(true);
    expect(isIgnoredError("AuthApiError: Invalid Refresh Token: Already Used")).toBe(true);
    expect(isIgnoredError("AuthSessionMissingError: Auth session missing!")).toBe(true);
    expect(isIgnoredError("Auto refresh tick failed with error. This is likely a transient error.")).toBe(true);
  });

  it("keeps real errors", () => {
    expect(isIgnoredError("Network request failed")).toBe(false);
    expect(isIgnoredError("Invalid login credentials")).toBe(false);
    expect(isIgnoredError("TypeError: undefined is not a function")).toBe(false);
  });
});

describe("reportError filtering", () => {
  afterEach(() => clearErrors());

  function currentBuffer(): AppError[] {
    let snapshot: AppError[] = [];
    const unsub = subscribe(errs => { snapshot = errs; });
    unsub();
    return snapshot;
  }

  it("does not buffer ignored auth errors", () => {
    reportError(new Error("Invalid Refresh Token: Refresh Token Not Found"), "unhandledRejection");
    expect(currentBuffer()).toHaveLength(0);
  });

  it("buffers real errors", () => {
    reportError(new Error("Network request failed"));
    expect(currentBuffer()).toHaveLength(1);
    expect(currentBuffer()[0].message).toBe("Network request failed");
  });
});
