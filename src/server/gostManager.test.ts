import { describe, it, expect, vi, beforeEach } from "vitest";
import { GostManager } from "./gostManager.js";
import { spawn } from "child_process";
import fs from "fs";

// Mock child_process and fs
vi.mock("child_process", () => ({
  spawn: vi.fn(() => ({
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
    pid: 1234
  }))
}));

vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(() => true)
  }
}));

describe("GostManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize with default values", () => {
    const manager = new GostManager();
    expect(manager.getStatus().running).toBe(false);
  });

  it("should start the gost process with correct arguments", () => {
    const manager = new GostManager("/bin/gost", ["-api", ":31132"]);
    manager.start();
    
    expect(spawn).toHaveBeenCalledWith(
      "/bin/gost",
      ["-api", ":31132"],
      expect.objectContaining({
        stdio: ["ignore", "ignore", "pipe"]
      })
    );
    expect(manager.getStatus().running).toBe(true);
    expect(manager.getStatus().pid).toBe(1234);
  });

  it("should handle log callbacks", () => {
    const manager = new GostManager();
    const logSpy = vi.fn();
    manager.setLogCallback(logSpy);

    // Get the stderr 'data' handler
    let stderrHandler: (data: Buffer) => void = () => {};
    vi.mocked(spawn).mockReturnValueOnce({
      stderr: {
        on: vi.fn((event, handler) => {
          if (event === "data") stderrHandler = handler;
        })
      },
      on: vi.fn(),
      pid: 1234
    } as any);

    manager.start();
    
    // Simulate log output
    stderrHandler(Buffer.from("test log line\n"));
    
    expect(logSpy).toHaveBeenCalledWith("test log line");
  });
});
