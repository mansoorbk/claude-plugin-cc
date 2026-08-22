import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  monitorClaudeProcess,
  runWindowsTaskkill,
  terminateProcessTree
} from "../plugins/claude-adversarial-review/scripts/claude-companion.mjs";
import * as runtime from "../plugins/claude-adversarial-review/scripts/claude-companion.mjs";
import {
  addWorkingCandidate,
  createRepository,
  makeTempDirectory,
  runCompanion
} from "./helpers/harness.mjs";

class FakeStream extends EventEmitter {
  constructor({ endError } = {}) {
    super();
    this.endError = endError;
    this.destroyed = false;
  }

  end() {
    if (this.endError) {
      throw this.endError;
    }
  }

  destroy() {
    this.destroyed = true;
  }
}

function fakeChild({ stdin = new FakeStream() } = {}) {
  const child = new EventEmitter();
  child.pid = 4242;
  child.exitCode = null;
  child.signalCode = null;
  child.stdin = stdin;
  child.stdout = new FakeStream();
  child.stderr = new FakeStream();
  child.kill = () => true;
  child.unref = () => {};
  return child;
}

function taskkillSpawn(status, configure) {
  return () => {
    const killer = new EventEmitter();
    killer.killCalls = 0;
    killer.kill = () => {
      killer.killCalls += 1;
    };
    configure?.(killer);
    queueMicrotask(() => killer.emit("close", status));
    return killer;
  };
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") {
      return false;
    }
    throw error;
  }
}

async function waitForProcessExit(pid, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processIsAlive(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !processIsAlive(pid);
}

function fakeObserverHelper() {
  const helper = new EventEmitter();
  helper.stdout = new PassThrough();
  helper.stderr = new PassThrough();
  helper.exitCode = null;
  helper.signalCode = null;
  helper.kill = () => {
    helper.exitCode = 0;
    queueMicrotask(() => helper.emit("close", 0));
    return true;
  };
  return helper;
}

test("Windows taskkill succeeds only when taskkill exits with status zero", async () => {
  const success = await runWindowsTaskkill(4242, {
    spawnImpl: taskkillSpawn(0),
    timeoutMs: 50
  });
  const failure = await runWindowsTaskkill(4242, {
    spawnImpl: taskkillSpawn(128),
    timeoutMs: 50
  });

  assert.deepEqual(success, { completed: true, status: 0 });
  assert.deepEqual(failure, { completed: false, status: 128 });
});

test("Windows taskkill ignores late timeout and error paths after it settles", async () => {
  let killer;
  const result = await runWindowsTaskkill(4242, {
    spawnImpl: taskkillSpawn(0, (value) => {
      killer = value;
    }),
    timeoutMs: 5
  });

  killer.emit("error", new Error("late error"));
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(result, { completed: true, status: 0 });
  assert.equal(killer.killCalls, 0, "the expired timer acted after taskkill had settled");
});

test("synchronous Windows cleanup helpers receive explicit bounded timeouts", () => {
  const timeoutError = Object.assign(new Error("synthetic helper timeout"), {
    code: "ETIMEDOUT"
  });
  let exactOptions;
  const exact = runtime.runWindowsExactProcessKill(4242, "1234", {
    timeoutMs: 249,
    spawnSyncImpl: (_command, _args, options) => {
      exactOptions = options;
      return { error: timeoutError, status: null };
    }
  });
  assert.equal(exactOptions.timeout, 249);
  assert.deepEqual(exact, { completed: false, status: null });

  let snapshotOptions;
  assert.throws(
    () => runtime.getWindowsProcessSnapshot({
      timeoutMs: 249,
      spawnSyncImpl: (_command, _args, options) => {
        snapshotOptions = options;
        return { error: timeoutError, status: null };
      }
    }),
    (error) => error?.code === "PROCESS_CLEANUP_FAILED"
  );
  assert.equal(snapshotOptions.timeout, 249);
});

test("Windows cleanup gives every synchronous helper less than its overall remaining budget", async () => {
  const child = fakeChild();
  child.windowsProcessTreeObserver = {
    retainedDescendants: async () => [
      { pid: 5001, creationTime: "1001" },
      { pid: 5002, creationTime: "1002" },
      { pid: 5003, creationTime: "1003" }
    ],
    stop: async () => {}
  };
  let now = 10_000;
  const observedTimeouts = [];
  const snapshot = [
    { pid: 5001, parentPid: 4242, creationTime: "1001" },
    { pid: 5002, parentPid: 4242, creationTime: "1002" },
    { pid: 5003, parentPid: 4242, creationTime: "1003" }
  ];

  await assert.rejects(
    terminateProcessTree(child, {
      platform: "win32",
      cleanupTimeoutMs: 5_000,
      nowFn: () => now,
      processIsAliveFn: () => false,
      getWindowsProcessSnapshotFn: ({ timeoutMs }) => {
        observedTimeouts.push(timeoutMs);
        now += 1_700;
        return snapshot;
      },
      runWindowsExactProcessKillFn: async (_pid, _creationTime, { timeoutMs }) => {
        observedTimeouts.push(timeoutMs);
        now += 1_700;
        return { completed: true, status: 0 };
      },
      waitForChildCloseFn: async () => true
    }),
    (error) => error?.code === "PROCESS_CLEANUP_FAILED"
  );

  assert.ok(observedTimeouts.length >= 2);
  assert.ok(observedTimeouts.every((timeoutMs) => timeoutMs > 0 && timeoutMs < 5_000));
  for (let index = 1; index < observedTimeouts.length; index += 1) {
    assert.ok(
      observedTimeouts[index] < observedTimeouts[index - 1],
      `helper timeout did not shrink: ${observedTimeouts.join(", ")}`
    );
  }
});

test("Windows cleanup classifies each synchronous helper timeout as cleanup failure", async (t) => {
  const timeoutResult = {
    error: Object.assign(new Error("synthetic helper timeout"), {
      code: "ETIMEDOUT"
    }),
    status: null
  };

  await t.test("process snapshot", async () => {
    const child = fakeChild();
    child.windowsProcessTreeObserver = {
      retainedDescendants: async () => [
        { pid: 5001, creationTime: "1001" }
      ],
      stop: async () => {}
    };
    await assert.rejects(
      terminateProcessTree(child, {
        platform: "win32",
        processIsAliveFn: () => false,
        getWindowsProcessSnapshotFn: ({ timeoutMs }) =>
          runtime.getWindowsProcessSnapshot({
            timeoutMs,
            spawnSyncImpl: () => timeoutResult
          }),
        waitForChildCloseFn: async () => true
      }),
      (error) => error?.code === "PROCESS_CLEANUP_FAILED"
    );
  });

  await t.test("exact identity killer", async () => {
    const child = fakeChild();
    child.windowsProcessTreeObserver = {
      retainedDescendants: async () => [
        { pid: 5001, creationTime: "1001" }
      ],
      stop: async () => {}
    };
    const snapshot = [
      { pid: 5001, parentPid: 4242, creationTime: "1001" }
    ];
    await assert.rejects(
      terminateProcessTree(child, {
        platform: "win32",
        processIsAliveFn: (pid) => pid === 5001,
        getWindowsProcessSnapshotFn: () => snapshot,
        runWindowsExactProcessKillFn: async (pid, creationTime, { timeoutMs }) =>
          runtime.runWindowsExactProcessKill(pid, creationTime, {
            timeoutMs,
            spawnSyncImpl: () => timeoutResult
          }),
        waitForChildCloseFn: async () => true
      }),
      (error) => error?.code === "PROCESS_CLEANUP_FAILED"
    );
  });
});

test(
  "a timed-out synchronous Windows helper is reaped",
  { skip: process.platform !== "win32" },
  async (t) => {
    const stateDirectory = makeTempDirectory(t, "hardening-sync-helper-timeout-");
    const pidPath = join(stateDirectory, "helper.pid");
    const result = runtime.runWindowsExactProcessKill(4242, "1234", {
      timeoutMs: 1_500,
      spawnSyncImpl: (_command, _args, options) => spawnSync(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$PID | Set-Content -LiteralPath $env:HARDENING_HELPER_PID_FILE; Start-Sleep -Seconds 30"
        ],
        {
          ...options,
          env: {
            ...process.env,
            HARDENING_HELPER_PID_FILE: pidPath
          }
        }
      )
    });

    assert.deepEqual(result, { completed: false, status: null });
    assert.ok(existsSync(pidPath), "the synthetic PowerShell helper did not start");
    const helperPid = Number.parseInt(readFileSync(pidPath, "utf8"), 10);
    t.after(() => {
      if (processIsAlive(helperPid)) {
        process.kill(helperPid);
      }
    });
    assert.equal(
      await waitForProcessExit(helperPid),
      true,
      `timed-out PowerShell helper ${helperPid} survived`
    );
  }
);

test("Windows observer is production-enabled and fails closed at its event bound", async () => {
  assert.equal(
    runtime.resolveRuntimeConfiguration({}).observeWindowsProcessTree,
    process.platform === "win32"
  );
  assert.equal(
    runtime.resolveRuntimeConfiguration({
      CLAUDE_ADVERSARIAL_REVIEW_TEST_MODE: "1"
    }).observeWindowsProcessTree,
    false
  );

  const helper = fakeObserverHelper();
  const pending = runtime.startWindowsProcessTreeObserver({
    spawnImpl: () => helper,
    readyTimeoutMs: 100,
    settleMs: 0,
    maxEvents: 1
  });
  helper.stdout.write("READY\n");
  const observer = await pending;
  observer.attach({ pid: 100 });
  helper.stdout.write("100,1,134318367514670000\n101,100,134318367514680000\n");

  await assert.rejects(
    observer.retainedDescendants(),
    (error) => error?.code === "PROCESS_CLEANUP_FAILED"
  );
  await observer.stop();
});

test("Windows observer ignores unrelated process churn when enforcing its owned-event bound", async () => {
  const helper = fakeObserverHelper();
  const pending = runtime.startWindowsProcessTreeObserver({
    spawnImpl: () => helper,
    readyTimeoutMs: 100,
    settleMs: 0,
    maxEvents: 2
  });
  helper.stdout.write("READY\n");
  const observer = await pending;
  observer.attach({ pid: 100 });
  helper.stdout.write("100,1,134318367514670000\n");
  for (let index = 0; index < 100; index += 1) {
    helper.stdout.write(
      `${1_000 + index},900,${134318367514680000n + BigInt(index) * 10_000n}\n`
    );
  }

  assert.deepEqual(await observer.retainedDescendants(), []);
  await observer.stop();
});

test("Unix observer retains an escaped descendant by its original owned lineage", async () => {
  assert.equal(typeof runtime.startUnixProcessTreeObserver, "function");
  const snapshots = [
    [],
    [
      { pid: 100, parentPid: 10, creationTime: "Fri Aug 22 10:00:00 2026" },
      { pid: 101, parentPid: 100, creationTime: "Fri Aug 22 10:00:01 2026" }
    ],
    [
      { pid: 101, parentPid: 1, creationTime: "Fri Aug 22 10:00:01 2026" }
    ]
  ];
  let latestSnapshot = [];
  const observer = await runtime.startUnixProcessTreeObserver({
    pollIntervalMs: 60_000,
    settleMs: 0,
    readSnapshotFn: async () => {
      latestSnapshot = snapshots.shift() || latestSnapshot;
      return latestSnapshot;
    }
  });
  observer.attach({ pid: 100 });
  await observer.observeNow();
  await observer.observeNow();

  const retained = await observer.retainedDescendants();
  assert.deepEqual(retained, [
    { pid: 101, parentPid: 100, creationTime: "Fri Aug 22 10:00:01 2026" }
  ]);
  await observer.stop();
});

test("Unix observer does not attach an unrelated child to a reused root PID in the same second", async () => {
  const sameSecond = "Fri Aug 22 10:00:00 2026";
  const snapshots = [
    [],
    [
      { pid: 100, parentPid: 10, creationTime: sameSecond },
      { pid: 101, parentPid: 100, creationTime: sameSecond }
    ],
    [{ pid: 101, parentPid: 1, creationTime: sameSecond }],
    [
      { pid: 100, parentPid: 20, creationTime: sameSecond },
      { pid: 101, parentPid: 1, creationTime: sameSecond },
      { pid: 102, parentPid: 100, creationTime: sameSecond }
    ]
  ];
  let latestSnapshot = [];
  const observer = await runtime.startUnixProcessTreeObserver({
    pollIntervalMs: 60_000,
    settleMs: 0,
    readSnapshotFn: async () => {
      latestSnapshot = snapshots.shift() || latestSnapshot;
      return latestSnapshot;
    }
  });
  observer.attach({ pid: 100 });
  await observer.observeNow();
  await observer.observeNow();
  await observer.observeNow();

  const retained = await observer.retainedDescendants();
  assert.deepEqual(retained.map(({ pid }) => pid), [101]);
  await observer.stop();
});

test("Unix observer retires an owned child identity before same-second PID reuse", async () => {
  const sameSecond = "Fri Aug 22 10:00:00 2026";
  const snapshots = [
    [],
    [
      { pid: 100, parentPid: 10, creationTime: sameSecond },
      { pid: 101, parentPid: 100, creationTime: sameSecond }
    ],
    [{ pid: 100, parentPid: 10, creationTime: sameSecond }],
    [
      { pid: 100, parentPid: 10, creationTime: sameSecond },
      { pid: 101, parentPid: 100, creationTime: sameSecond }
    ]
  ];
  const observer = await runtime.startUnixProcessTreeObserver({
    pollIntervalMs: 60_000,
    settleMs: 0,
    readSnapshotFn: async () => snapshots.shift() || []
  });
  observer.attach({ pid: 100 });
  await observer.observeNow();
  await observer.observeNow();
  await observer.observeNow();

  assert.deepEqual(await observer.retainedDescendants(), []);
  await observer.stop();
});

test("Unix observer ignores unrelated process churn when enforcing its owned-event bound", async () => {
  const unrelated = Array.from({ length: 100 }, (_unused, index) => ({
    pid: 1_000 + index,
    parentPid: 900,
    creationTime: `Fri Aug 22 10:00:${String(index % 60).padStart(2, "0")} 2026`
  }));
  const snapshots = [
    [],
    [{ pid: 100, parentPid: 10, creationTime: "Fri Aug 22 10:00:00 2026" }],
    [{ pid: 100, parentPid: 10, creationTime: "Fri Aug 22 10:00:00 2026" }, ...unrelated]
  ];
  const observer = await runtime.startUnixProcessTreeObserver({
    pollIntervalMs: 60_000,
    settleMs: 0,
    maxEvents: 2,
    readSnapshotFn: async () => snapshots.shift() || []
  });
  observer.attach({ pid: 100 });
  await observer.observeNow();
  await observer.observeNow();

  assert.deepEqual(await observer.retainedDescendants(), []);
  await observer.stop();
});

test("Unix observer stops polling after its first terminal snapshot failure", async () => {
  let calls = 0;
  const observer = await runtime.startUnixProcessTreeObserver({
    pollIntervalMs: 1,
    settleMs: 0,
    readSnapshotFn: async () => {
      calls += 1;
      if (calls === 1) {
        return [];
      }
      throw new Error("synthetic terminal snapshot failure");
    }
  });
  observer.attach({ pid: 100 });
  await assert.rejects(observer.observeNow(), (error) => error?.code === "PROCESS_CLEANUP_FAILED");
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(calls, 2, "terminal observer failure continued launching snapshots");
  await observer.stop();
});

test("Unix observer stop aborts the one active snapshot", { timeout: 2_000 }, async () => {
  let calls = 0;
  let aborted = false;
  const observer = await runtime.startUnixProcessTreeObserver({
    pollIntervalMs: 60_000,
    readSnapshotFn: async ({ signal } = {}) => {
      calls += 1;
      if (calls === 1) {
        return [];
      }
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("snapshot aborted"));
        }, { once: true });
      });
    }
  });
  observer.attach({ pid: 100 });
  const active = observer.observeNow().catch(() => {});

  await observer.stop(50);
  await active;

  assert.equal(aborted, true);
  assert.equal(calls, 2, "stop launched or retained an unexpected snapshot");
});

test("Unix snapshot cancellation kills the active ps helper", async () => {
  const helper = new EventEmitter();
  helper.stdout = new PassThrough();
  helper.stderr = new PassThrough();
  const killSignals = [];
  helper.kill = (signal) => {
    killSignals.push(signal);
    return true;
  };
  const controller = new AbortController();
  const snapshot = runtime.getUnixProcessSnapshot({
    spawnImpl: () => helper,
    timeoutMs: 5_000,
    signal: controller.signal
  });

  controller.abort();

  await assert.rejects(snapshot, (error) => error?.code === "PROCESS_CLEANUP_FAILED");
  assert.deepEqual(killSignals, ["SIGKILL"]);
});

test("Unix observer reuses one bounded stop result instead of starting a second timeout", { timeout: 2_000 }, async () => {
  let calls = 0;
  const observer = await runtime.startUnixProcessTreeObserver({
    pollIntervalMs: 60_000,
    readSnapshotFn: async () => {
      calls += 1;
      if (calls === 1) {
        return [];
      }
      return new Promise(() => {});
    }
  });
  observer.attach({ pid: 100 });
  void observer.observeNow();

  const firstError = await observer.stop(20).then(
    () => null,
    (error) => error
  );
  const callsAfterFirstStop = calls;
  const secondError = await observer.stop().then(
    () => null,
    (error) => error
  );

  assert.equal(firstError?.code, "PROCESS_CLEANUP_FAILED");
  assert.strictEqual(secondError, firstError, "stop did not reuse its settled failure");
  assert.equal(calls, callsAfterFirstStop, "a second stop launched another snapshot");
});

test("Unix cleanup signals only the retained descendant identity that is still present", async () => {
  const child = fakeChild();
  child.unixProcessTreeObserver = {
    retainedDescendants: async () => [
      { pid: 101, parentPid: 100, creationTime: "Fri Aug 22 10:00:01 2026" }
    ],
    retainedRoot: () => null,
    stop: async () => {}
  };
  let descendantAlive = true;
  const signals = [];

  await terminateProcessTree(child, {
    platform: "linux",
    cleanupTimeoutMs: 1_000,
    getUnixProcessSnapshotFn: async () => descendantAlive
      ? [{ pid: 101, parentPid: 1, creationTime: "Fri Aug 22 10:00:01 2026" }]
      : [],
    signalProcessFn: (pid, signal) => {
      signals.push([pid, signal]);
      if (pid === 101) {
        descendantAlive = false;
      }
    },
    waitForProcessExitFn: async () => true
  });

  assert.ok(
    signals.some(([pid, signal]) => pid === 101 && signal === "SIGTERM"),
    "cleanup did not target the retained escaped identity"
  );
});

test("Unix cleanup does not signal a reused PID with a different creation identity", async () => {
  const child = fakeChild();
  child.unixProcessTreeObserver = {
    retainedDescendants: async () => [
      { pid: 101, parentPid: 100, creationTime: "Fri Aug 22 10:00:01 2026" }
    ],
    retainedRoot: () => null,
    stop: async () => {}
  };
  const signals = [];

  await terminateProcessTree(child, {
    platform: "linux",
    cleanupTimeoutMs: 1_000,
    getUnixProcessSnapshotFn: async () => [
      { pid: 101, parentPid: 1, creationTime: "Fri Aug 22 10:00:02 2026" }
    ],
    signalProcessFn: (pid, signal) => signals.push([pid, signal]),
    waitForProcessExitFn: async () => true
  });

  assert.equal(
    signals.some(([pid]) => pid === 101),
    false,
    "cleanup signalled a PID whose creation identity no longer matched"
  );
});

test("Unix cleanup does not signal the root process group after its identity retired", async () => {
  const child = fakeChild();
  child.unixProcessTreeObserver = {
    retainedDescendants: async () => [],
    retainedRoot: () => null,
    stop: async () => {}
  };
  const signals = [];

  await terminateProcessTree(child, {
    platform: "linux",
    cleanupTimeoutMs: 1_000,
    signalProcessFn: (pid, signal) => signals.push([pid, signal]),
    waitForProcessExitFn: async () => true
  });

  assert.deepEqual(signals, []);
});

test("Unix cleanup rejects before an observer refresh that cannot fit its shared deadline", { timeout: 2_000 }, async () => {
  const child = fakeChild();
  let retainedCalls = 0;
  let stopCalls = 0;
  child.unixProcessTreeObserver = {
    retainedDescendants: async () => {
      retainedCalls += 1;
      return [];
    },
    retainedRoot: () => null,
    stop: async () => {
      stopCalls += 1;
    }
  };
  const clockValues = [1_000, 1_100, 1_100];
  let clockIndex = 0;

  await assert.rejects(
    terminateProcessTree(child, {
      platform: "linux",
      cleanupTimeoutMs: 100,
      nowFn: () => clockValues[Math.min(clockIndex++, clockValues.length - 1)],
      signalProcessFn: () => {},
      waitForProcessExitFn: async () => true
    }),
    (error) => error?.code === "PROCESS_CLEANUP_FAILED"
  );

  assert.equal(retainedCalls, 0, "cleanup began retained-lineage work that could not fit");
  assert.equal(stopCalls, 1, "cleanup did not stop its observer after deadline rejection");
});

test("Windows cleanup confirms an already-gone parent with no owned descendants", async () => {
  const child = fakeChild();
  let taskkillCalls = 0;

  await terminateProcessTree(child, {
    platform: "win32",
    processIsAliveFn: () => false,
    runWindowsTaskkillFn: async () => {
      taskkillCalls += 1;
      return { completed: true, status: 0 };
    },
    listWindowsDescendantPidsFn: async () => [],
    waitForChildCloseFn: async () => true
  });

  assert.equal(taskkillCalls, 0, "cleanup targeted a process outside an owned tree");
});

test(
  "Windows cleanup terminates an owned detached grandchild after its parent exits",
  { skip: process.platform !== "win32" },
  async (t) => {
    const stateDirectory = makeTempDirectory(t, "hardening-orphan-tree-");
    const pidPath = join(stateDirectory, "grandchild.pid");
    const readyPath = join(stateDirectory, "grandchild.ready");
    const fixturePath = join(
      dirname(fileURLToPath(import.meta.url)),
      "fixtures",
      "hardening-exit-after-detached-grandchild.mjs"
    );
    const parent = spawn(process.execPath, [fixturePath], {
      env: {
        ...process.env,
        HARDENING_GRANDCHILD_PID_FILE: pidPath,
        HARDENING_GRANDCHILD_READY_FILE: readyPath
      },
      windowsHide: true
    });
    await new Promise((resolve, reject) => {
      parent.once("error", reject);
      parent.once("close", resolve);
    });
    assert.ok(existsSync(pidPath));
    assert.ok(existsSync(readyPath));
    const grandchildPid = Number.parseInt(readFileSync(pidPath, "utf8"), 10);
    t.after(() => {
      if (processIsAlive(grandchildPid)) {
        process.kill(grandchildPid);
      }
    });
    assert.equal(processIsAlive(grandchildPid), true);

    await terminateProcessTree(parent);

    assert.equal(
      await waitForProcessExit(grandchildPid),
      true,
      `owned detached grandchild ${grandchildPid} survived cleanup`
    );
  }
);

test(
  "Windows cleanup retains a vanished intermediate lineage to its detached grandchild",
  { skip: process.platform !== "win32" },
  async (t) => {
    assert.equal(typeof runtime.startWindowsProcessTreeObserver, "function");
    const stateDirectory = makeTempDirectory(t, "hardening-vanished-lineage-");
    const pidPath = join(stateDirectory, "grandchild.pid");
    const readyPath = join(stateDirectory, "grandchild.ready");
    const fixturePath = join(
      dirname(fileURLToPath(import.meta.url)),
      "fixtures",
      "hardening-spawn-vanishing-lineage.mjs"
    );
    const observer = await runtime.startWindowsProcessTreeObserver();
    const parent = spawn(process.execPath, [fixturePath], {
      env: {
        ...process.env,
        HARDENING_GRANDCHILD_PID_FILE: pidPath,
        HARDENING_GRANDCHILD_READY_FILE: readyPath
      },
      windowsHide: true
    });
    observer.attach(parent);
    await new Promise((resolve, reject) => {
      parent.once("error", reject);
      parent.once("close", resolve);
    });
    const grandchildPid = Number.parseInt(readFileSync(pidPath, "utf8"), 10);
    t.after(async () => {
      await observer.stop();
      if (processIsAlive(grandchildPid)) {
        process.kill(grandchildPid);
      }
    });
    assert.equal(processIsAlive(grandchildPid), true);

    const retained = await observer.retainedDescendants();
    assert.ok(
      retained.some((record) => record.pid === grandchildPid),
      `observer did not retain detached grandchild ${grandchildPid}`
    );
    assert.equal(
      runtime.getWindowsProcessSnapshot().find((record) => record.pid === grandchildPid)?.creationTime,
      retained.find((record) => record.pid === grandchildPid)?.creationTime,
      "observer and cleanup snapshots disagreed on grandchild creation identity"
    );

    const killedPids = [];
    await terminateProcessTree(parent, {
      runWindowsExactProcessKillFn: async (pid, creationTime) => {
        killedPids.push(pid);
        return runtime.runWindowsExactProcessKill(pid, creationTime);
      }
    });
    assert.ok(killedPids.includes(grandchildPid), "cleanup did not target retained grandchild");

    assert.equal(
      await waitForProcessExit(grandchildPid),
      true,
      `detached grandchild ${grandchildPid} survived its vanished owned lineage`
    );
  }
);

test(
  "post-close malformed output cleans the surviving owned descendant",
  { timeout: 20_000 },
  async (t) => {
    const cwd = createRepository(t);
    addWorkingCandidate(cwd);
    const stateDirectory = makeTempDirectory(t, "hardening-post-close-cleanup-");
    const pidPath = join(stateDirectory, "grandchild.pid");
    const readyPath = join(stateDirectory, "grandchild.ready");
    const fixturePath = join(
      dirname(fileURLToPath(import.meta.url)),
      "fixtures",
      "hardening-malformed-after-grandchild.mjs"
    );

    const review = runCompanion(cwd, [], {
      env: {
        CLAUDE_ADVERSARIAL_REVIEW_CLAUDE_COMMAND: JSON.stringify([
          process.execPath,
          fixturePath
        ]),
        CLAUDE_ADVERSARIAL_REVIEW_OBSERVE_WINDOWS_PROCESS_TREE: "1",
        HARDENING_GRANDCHILD_PID_FILE: pidPath,
        HARDENING_GRANDCHILD_READY_FILE: readyPath
      }
    });

    assert.notEqual(review.status, 0);
    assert.match(review.stderr, /INVALID_CLAUDE_RESULT/);
    assert.ok(existsSync(pidPath));
    assert.ok(existsSync(readyPath));
    const grandchildPid = Number.parseInt(readFileSync(pidPath, "utf8"), 10);
    t.after(() => {
      if (processIsAlive(grandchildPid)) {
        process.kill(grandchildPid);
      }
    });
    assert.equal(
      await waitForProcessExit(grandchildPid),
      true,
      `owned descendant ${grandchildPid} survived post-close validation failure`
    );
  }
);

test(
  "Unix cleanup terminates a descendant that escaped into a new session before its parent closed",
  { skip: process.platform === "win32", timeout: 20_000 },
  async (t) => {
    const cwd = createRepository(t);
    addWorkingCandidate(cwd);
    const stateDirectory = makeTempDirectory(t, "hardening-unix-escaped-tree-");
    const pidPath = join(stateDirectory, "grandchild.pid");
    const readyPath = join(stateDirectory, "grandchild.ready");
    const fixturePath = join(
      dirname(fileURLToPath(import.meta.url)),
      "fixtures",
      "hardening-malformed-after-escaped-descendant.mjs"
    );

    const review = runCompanion(cwd, [], {
      env: {
        CLAUDE_ADVERSARIAL_REVIEW_CLAUDE_COMMAND: JSON.stringify([
          process.execPath,
          fixturePath
        ]),
        CLAUDE_ADVERSARIAL_REVIEW_OBSERVE_UNIX_PROCESS_TREE: "1",
        HARDENING_GRANDCHILD_PID_FILE: pidPath,
        HARDENING_GRANDCHILD_READY_FILE: readyPath
      }
    });

    assert.notEqual(review.status, 0);
    assert.match(review.stderr, /INVALID_CLAUDE_RESULT/);
    assert.ok(existsSync(pidPath));
    assert.ok(existsSync(readyPath));
    const grandchildPid = Number.parseInt(readFileSync(pidPath, "utf8"), 10);
    t.after(() => {
      if (processIsAlive(grandchildPid)) {
        process.kill(grandchildPid, "SIGKILL");
      }
    });
    assert.equal(
      await waitForProcessExit(grandchildPid),
      true,
      `escaped owned descendant ${grandchildPid} survived post-close cleanup`
    );
  }
);

test("Windows cleanup rejects an unconfirmed nonzero taskkill exit", async () => {
  const child = fakeChild();

  await assert.rejects(
    terminateProcessTree(child, {
      platform: "win32",
      processIsAliveFn: () => true,
      runWindowsTaskkillFn: async () => ({ completed: false, status: 128 }),
      waitForChildCloseFn: async () => true
    }),
    (error) => {
      assert.equal(error?.code, "PROCESS_CLEANUP_FAILED");
      assert.deepEqual(error.details?.cleanup, {
        killUnconfirmed: true,
        targetIdentityStillAlive: true,
        childCloseUnconfirmed: false,
        rootPidAliveAfterCleanup: true
      });
      return true;
    }
  );
});

for (const streamName of ["stdout", "stderr", "stdin"]) {
  test(`${streamName} stream errors force process-tree cleanup`, async () => {
    const child = fakeChild();
    let cleanupCalls = 0;
    const pending = monitorClaudeProcess(child, "review prompt", {
      timeoutMs: 500,
      terminateProcessTreeFn: async () => {
        cleanupCalls += 1;
      }
    });

    child[streamName].emit("error", new Error(`${streamName} failure`));

    await assert.rejects(pending, (error) => error?.code === "CLAUDE_IO_FAILED");
    assert.equal(cleanupCalls, 1);
  });
}

test("a synchronous stdin write error forces process-tree cleanup", async () => {
  const child = fakeChild({ stdin: new FakeStream({ endError: new Error("sync stdin failure") }) });
  let cleanupCalls = 0;

  await assert.rejects(
    monitorClaudeProcess(child, "review prompt", {
      timeoutMs: 500,
      terminateProcessTreeFn: async () => {
        cleanupCalls += 1;
      }
    }),
    (error) => error?.code === "CLAUDE_IO_FAILED"
  );

  assert.equal(cleanupCalls, 1);
});
