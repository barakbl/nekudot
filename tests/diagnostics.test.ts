import { beforeEach, describe, it, expect } from "vitest";
import {
  setDiagnostics,
  isDiagnostics,
  dlog,
  clearDiagnostics,
  diagnosticsCount,
  diagnosticsText,
  setDiagnosticOverride,
  diagnosticOverride,
} from "../src/diagnostics";

// Reset the singleton between tests.
beforeEach(() => {
  setDiagnostics(false);
  clearDiagnostics();
});

describe("diagnostics", () => {
  it("is a no-op when disabled", () => {
    expect(isDiagnostics()).toBe(false);
    dlog("test", "ignored");
    expect(diagnosticsCount()).toBe(0);
  });

  it("captures entries once enabled and clears them", () => {
    setDiagnostics(true);
    expect(isDiagnostics()).toBe(true);
    const before = diagnosticsCount(); // "diagnostics enabled" + env snapshot
    dlog("stroke", "begin", { alpha: 0.3 });
    expect(diagnosticsCount()).toBe(before + 1);
    clearDiagnostics();
    expect(diagnosticsCount()).toBe(0);
  });

  it("renders a shareable text report with the data inlined", () => {
    setDiagnostics(true);
    dlog("stroke", "begin", { alpha: 0.3, brush: "Round" });
    const text = diagnosticsText();
    expect(text).toContain("# Nekudot diagnostics");
    expect(text).toContain("## environment");
    expect(text).toContain("[stroke] begin");
    expect(text).toContain('"alpha":0.3');
    expect(text).toContain('"brush":"Round"');
  });

  it("tracks try-a-fix overrides independently of logging", () => {
    expect(diagnosticOverride("disableWetOverlay")).toBe(false);
    setDiagnosticOverride("disableWetOverlay", true);
    expect(diagnosticOverride("disableWetOverlay")).toBe(true);
    setDiagnosticOverride("disableWetOverlay", false);
    expect(diagnosticOverride("disableWetOverlay")).toBe(false);
  });

  it("stops capturing after being disabled again", () => {
    setDiagnostics(true);
    clearDiagnostics();
    setDiagnostics(false);
    dlog("test", "ignored");
    expect(diagnosticsCount()).toBe(0);
  });
});
