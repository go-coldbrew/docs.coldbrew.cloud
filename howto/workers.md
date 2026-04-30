---
layout: default
title: "Workers"
parent: "How To"
nav_order: 15
description: "How to use go-coldbrew/workers to manage background goroutines with middleware, jitter, panic recovery, restart, and structured shutdown."
---
## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

## Overview

[workers] is a worker lifecycle library that manages background goroutines with automatic panic recovery, configurable restart with backoff, and structured shutdown. It is built on top of [suture], an Erlang-inspired supervisor tree library for Go.

Every worker runs inside its own supervisor subtree:

```text
Root Supervisor
├── Worker-A supervisor
│   ├── Worker-A service (middleware → handler)
│   ├── Child-A1 (added dynamically)
│   └── Child-A2
└── Worker-B supervisor
    └── Worker-B service (middleware → handler)
```

**Key properties:**
- **Scoped lifecycle** — when a parent stops, all its children stop automatically. No manual cleanup or `sync.WaitGroup` needed.
- **Restart by default** — workers restart with exponential backoff on failure. One-shot workers opt out with `WithRestart(false)` or return `ErrDoNotRestart`.
- **Two-layer panic recovery** — suture catches panics at the supervisor level (restarts the worker). `middleware.Recover` catches panics per-cycle (converts to error without a full restart). Use both for defense in depth.
- **Composable middleware** — tracing, structured logging, distributed locking, per-cycle timeout, and duration metrics as gRPC-style interceptors. Write your own with a single function.
- **Jitter** — desynchronize periodic workers to prevent thundering herd. Per-worker or run-level default.
- **Dynamic children** — workers can spawn and remove child workers at runtime via `Add`/`Remove`. Children inherit middleware, metrics, and scoped lifecycle.
- **Pluggable metrics** — Prometheus out of the box, or implement the `Metrics` interface for Datadog, StatsD, etc. Per-attempt lifetime and per-cycle duration tracked separately.
- **Handler cleanup** — `CycleHandler.Close()` is called exactly once when the worker permanently stops, for resource cleanup (DB connections, leases).

## Quick Start

```go
package main

import (
    "context"
    "log/slog"
    "os"
    "os/signal"
    "time"

    "github.com/go-coldbrew/workers"
    "github.com/go-coldbrew/workers/middleware"
)

func main() {
    ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
    defer cancel()

    err := workers.Run(ctx, []*workers.Worker{
        // Long-running worker — blocks until ctx is cancelled
        workers.NewWorker("kafka").HandlerFunc(consume),

        // Periodic worker — runs cleanup every 5 minutes with jitter
        workers.NewWorker("cleanup").HandlerFunc(cleanup).
            Every(5 * time.Minute).WithJitter(10),
    },
        // Standard observability: panic recovery, log context, tracing, structured logging
        workers.WithInterceptors(middleware.DefaultInterceptors()...),
    )
    if err != nil {
        slog.Error("workers failed", "error", err)
    }
}

// consume and cleanup have signature:
//   func(ctx context.Context, info *workers.WorkerInfo) error
```

`Run` blocks until `ctx` is cancelled and all workers have exited.

## Why Workers (vs Plain Goroutines)

With plain goroutines, you manage lifecycle manually:

```go
// Before: manual goroutine management
ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
defer cancel()

var wg sync.WaitGroup
wg.Add(1)
go func() {
    defer wg.Done()
    // no panic recovery — crashes the process
    // no restart — dies permanently on error
    // no structured shutdown — must coordinate ctx + wg manually
    // no distributed locking — runs on every pod
    consume(ctx)
}()
wg.Wait()
```

With workers, the framework handles all of that:

```go
// After: workers handle lifecycle
workers.Run(ctx, []*workers.Worker{
    workers.NewWorker("kafka").HandlerFunc(consume).
        Interceptors(
            middleware.Recover(onPanic),
            middleware.Tracing(),
            middleware.DistributedLock(redisLocker),
        ),
})
```

**What you get for free:** panic recovery, configurable restart with exponential backoff, scoped lifecycle (children stop when parents stop), composable middleware (tracing, logging, distributed locking, per-cycle timeout), jitter for periodic workers, and pluggable metrics. Distributed locking ensures only one instance runs a job across pods — no manual coordination.

## Creating Workers

Use `NewWorker` with a name, then set a handler via `HandlerFunc` (for plain functions) or `Handler` (for structs with cleanup):

```go
// Uses github.com/go-coldbrew/log for structured logging
w := workers.NewWorker("my-worker").HandlerFunc(func(ctx context.Context, info *workers.WorkerInfo) error {
    log.Info(ctx, "msg", "started", "worker", info.GetName(), "attempt", info.GetAttempt())
    <-ctx.Done()
    return ctx.Err()
})
```

For handlers that need resource cleanup, implement the `CycleHandler` interface. `Close()` is called exactly once when the worker permanently stops:

```go
type batchProcessor struct {
    db   *sql.DB
    conn *sql.Conn // dedicated connection for this worker
}

func NewBatchProcessor(db *sql.DB) (*batchProcessor, error) {
    conn, err := db.Conn(context.Background())
    if err != nil {
        return nil, err
    }
    return &batchProcessor{db: db, conn: conn}, nil
}

func (b *batchProcessor) RunCycle(ctx context.Context, info *workers.WorkerInfo) error {
    rows, err := b.conn.QueryContext(ctx,
        "SELECT id, payload FROM jobs WHERE status = 'pending' LIMIT 100")
    if err != nil {
        return err
    }
    defer rows.Close()
    return processBatch(ctx, rows)
}

func (b *batchProcessor) Close() error {
    // Called once on permanent stop — release the dedicated connection
    return b.conn.Close()
}
```

The handler receives a `context.Context` for cancellation and a `*WorkerInfo` for worker metadata.

## Handler Return Values

| Return value | Long-running worker (no `Every`) | Periodic worker (with `Every`) |
|---|---|---|
| `return nil` | Worker stops permanently | Cycle succeeded — next tick fires |
| `return workers.ErrSkipTick` | Treated like `return error` (not meaningful) | Tick skipped — next tick fires normally |
| `return error` | Restarts with backoff (if restart enabled) | Restarts with backoff (if restart enabled) |
| `return ctx.Err()` | Clean shutdown | Clean shutdown |
| `return workers.ErrDoNotRestart` | Permanent stop | Permanent stop |

**Long-running workers** should block on `<-ctx.Done()`, then return `ctx.Err()`. Returning nil without waiting for ctx cancellation stops the worker permanently.

**Periodic workers** run the handler once per tick. Return nil for success (next tick fires normally). Return an error to trigger restart. The `Every` wrapper manages the tick loop — your handler just processes one cycle.

### ErrSkipTick

Return `workers.ErrSkipTick` from a periodic handler when a tick fails transiently (DB timeout, network blip) and you want to skip it without triggering a full restart. The timer continues and the next tick fires normally:

```go
func pollDatabase(ctx context.Context, info *workers.WorkerInfo) error {
    rows, err := db.QueryContext(ctx, "SELECT ...")
    if err != nil {
        if ctx.Err() != nil {
            return ctx.Err() // context cancelled — clean shutdown
        }
        return workers.ErrSkipTick // transient failure, try again next interval
    }
    defer rows.Close()
    return processRows(rows)
}
```

Without `ErrSkipTick`, you'd have to swallow errors by returning nil and track them internally. `ErrSkipTick` gives the framework visibility into skipped ticks while keeping the timer going.

### ErrDoNotRestart

Return `workers.ErrDoNotRestart` from a handler to signal permanent completion — the supervisor will not restart the worker even though restart is enabled by default. `ChannelWorker` and `BatchChannelWorker` return this automatically when their channel is closed.

```go
func processQueue(ctx context.Context, info *workers.WorkerInfo) error {
    item, ok := queue.Dequeue(ctx)
    if !ok {
        return workers.ErrDoNotRestart // queue exhausted
    }
    return process(ctx, item)
}
```

## Builder Methods

| Method | Description | Default |
|--------|-------------|---------|
| `HandlerFunc(fn)` | Set handler from a plain function | — |
| `Handler(h)` | Set handler from a `CycleHandler` struct | — |
| `WithRestart(false)` | Disable restart (one-shot worker). Periodic workers should generally keep the default; use `ErrSkipTick`/`ErrDoNotRestart` instead. | `true` (restart with backoff) |
| `Every(duration)` | Run periodically on a fixed interval | — |
| `WithJitter(percent)` | Randomize tick interval by ±percent (requires `Every`) | inherit run-level |
| `WithInitialDelay(d)` | Delay first tick (requires `Every`) | — |
| `Interceptors(mw...)` | Replace worker-level middleware | — |
| `AddInterceptors(mw...)` | Append to worker-level middleware | — |
| `WithFailureBackoff(d)` | Duration between restarts | 15s (suture default) |
| `WithFailureThreshold(n float64)` | Max failures before supervisor gives up | 5.0 (suture default) |
| `WithFailureDecay(rate float64)` | Rate at which failure count decays (per second) | 1.0 (suture default) |
| `WithBackoffJitter(j)` | Random jitter on restart backoff | none |
| `WithTimeout(d)` | Max time to wait for graceful stop | 10s (suture default) |
| `WithMetrics(m Metrics)` | Per-worker metrics override | inherit from parent/run |

Example with full configuration:

```go
workers.NewWorker("resilient-consumer").HandlerFunc(consume).
    Every(15 * time.Second).
    WithJitter(10).
    WithInitialDelay(5 * time.Second).
    Interceptors(
        middleware.Recover(onPanic),
        middleware.Tracing(),
    ).
    WithFailureBackoff(5 * time.Second).
    WithFailureThreshold(10).
    WithTimeout(30 * time.Second)
```

## Jitter

When many workers share the same base interval (e.g. 15s), they synchronize and spike downstream services — the [thundering herd](https://en.wikipedia.org/wiki/Thundering_herd_problem) problem. Jitter desynchronizes ticks by randomizing each interval within a configurable range.

### Per-worker jitter

```go
workers.NewWorker("poller").HandlerFunc(poll).
    Every(15 * time.Second).
    WithJitter(10) // each tick is within [13.5s, 16.5s)
```

### Run-level default

Apply jitter to all periodic workers with `WithDefaultJitter`:

```go
workers.Run(ctx, myWorkers, workers.WithDefaultJitter(10))
```

Worker-level `WithJitter` takes precedence over the run-level default. Setting `WithJitter(0)` explicitly disables jitter for a specific worker even when a run-level default is set.

### Formula

On each tick:
```text
spread   = base × percent ÷ 100
jittered = base − spread + rand(2 × spread)
```

The effective interval is clamped to a minimum of 1ms (never zero or negative). Each tick recomputes independently — successive intervals differ.

### Initial delay

`WithInitialDelay` delays the first tick, preventing N workers from all firing at t=0 on process start:

```go
workers.NewWorker("poller").HandlerFunc(poll).
    Every(15 * time.Second).
    WithJitter(10).
    WithInitialDelay(5 * time.Second)
```

## Middleware

Middleware wraps each worker execution cycle with cross-cutting concerns like panic recovery, tracing, distributed locking, and timing. For periodic workers (`Every`), middleware runs on every tick, not once for the worker lifetime.

### Types

```go
// CycleHandler handles worker execution cycles.
// Implement as a struct for handlers that need cleanup.
type CycleHandler interface {
    RunCycle(ctx context.Context, info *WorkerInfo) error
    Close() error  // called once when the worker stops
}

// CycleFunc adapts a plain function into a CycleHandler.
// Close is a no-op — use this for simple, stateless handlers.
type CycleFunc func(ctx context.Context, info *WorkerInfo) error

// Middleware intercepts each execution cycle.
// Call next to continue the chain. Matches gRPC interceptor convention.
type Middleware func(ctx context.Context, info *WorkerInfo, next CycleFunc) error
```

### Worker-level middleware

```go
w := workers.NewWorker("solver").HandlerFunc(solve).
    Every(15 * time.Second).
    Interceptors(
        middleware.Recover(onPanic),
        middleware.Tracing(),
        middleware.Duration(observeDuration),
    )
```

The first middleware in the list is the outermost wrapper (runs first on entry, last on exit), matching the gRPC interceptor convention.

### Run-level middleware

`WithInterceptors` replaces and `AddInterceptors` appends to the run-level middleware list. These are **run options** that apply to all workers in the `Run` call — distinct from the worker-level `(*Worker).Interceptors` and `(*Worker).AddInterceptors` which only affect a single worker. Run-level middleware wraps **outside** worker-level middleware, so shared concerns like tracing are always outermost:

```go
workers.Run(ctx, myWorkers,
    workers.WithInterceptors(middleware.DefaultInterceptors()...),
    workers.AddInterceptors(middleware.Duration(observe)),
)
```

Effective chain: `run-level middleware → worker-level middleware → handler`

### Writing custom middleware

Middleware is a flat function that calls `next` to continue the chain. The `*WorkerInfo` parameter gives you the worker name and attempt explicitly — no hidden context lookups:

```go
// Uses github.com/go-coldbrew/log for structured logging
func myLogging(ctx context.Context, info *workers.WorkerInfo, next workers.CycleFunc) error {
    log.Info(ctx, "msg", "cycle start", "worker", info.GetName())
    err := next(ctx, info)
    log.Info(ctx, "msg", "cycle end", "worker", info.GetName(), "error", err)
    return err
}

// Attach it
w.Interceptors(myLogging)
```

Same shape as gRPC interceptors — familiar to the target audience:
```go
// gRPC:   func(ctx, req, info, handler) (resp, error)
// Workers: func(ctx, info, next) error
```

## Built-in Middleware

The `middleware` sub-package ships optional middleware. None are applied by default.

```go
import "github.com/go-coldbrew/workers/middleware"
```

| Middleware | Description |
|-----------|-------------|
| `Recover(onPanic)` | Catches panics, calls callback, returns error |
| `Tracing()` | Creates an OTEL span per cycle via go-coldbrew/tracing |
| `Duration(observe)` | Measures wall-clock time of each cycle |
| `DistributedLock(locker, opts...)` | Acquires a distributed lock before each cycle |
| `Timeout(d)` | Enforces a per-cycle deadline |
| `Slog()` | Structured log lines per cycle (start + end/error) via go-coldbrew/log |
| `LogContext()` | Injects worker name + attempt into log context |
| `DefaultInterceptors()` | Returns `[Recover, LogContext, Tracing, Slog]` |

### Recover

Catches panics in the worker cycle and converts them to errors. The panic does not propagate:

```go
middleware.Recover(func(name string, v any) {
    alerting.Send(fmt.Sprintf("worker %s panicked: %v", name, v))
})
```

### Tracing

Creates an OTEL span named `worker:<name>:cycle` for each tick. Records errors on the span. Worker spans are typically trace roots (no incoming parent), so sampling is determined by the global `TracerProvider`'s sampler — if you use `ParentBased(TraceIDRatioBased(...))` with a low ratio, worker spans may be probabilistically dropped. Use `AlwaysSample()` for the worker `TracerProvider` if you need every cycle traced.

The OTEL trace ID is automatically injected into the log context as `trace` for correlation with your tracing backend.

```go
middleware.Tracing()
```

### Duration

Measures wall-clock time of each cycle and calls a callback. This is **per-cycle** timing — distinct from the per-attempt lifetime captured by `Metrics.ObserveRunDuration` (the `worker_run_duration_seconds` Prometheus histogram).

```go
middleware.Duration(func(name string, d time.Duration) {
    metrics.RecordCycleDuration(name, d)
})
```

### DistributedLock

Acquires a distributed lock before each cycle. If the lock is held by another instance, the cycle is skipped:

```go
middleware.DistributedLock(redisLocker,
    middleware.WithKeyFunc(func(name string) string {
        return "myapp:lock:" + name
    }),
    middleware.WithTTLFunc(func(_ string) time.Duration {
        return time.Minute
    }),
    middleware.WithOnNotAcquired(func(ctx context.Context, name string) error {
        log.Info(ctx, "msg", "lock held, skipping", "worker", name) // go-coldbrew/log
        return nil
    }),
)
```

For the common case of logging and skipping, use `WithSkipOnNotAcquired`:

```go
middleware.DistributedLock(redisLocker,
    middleware.WithSkipOnNotAcquired(func(ctx context.Context, name string) {
        log.Info(ctx, "msg", "lock held, skipping", "worker", name)
    }),
)
```

**Caution:** If the `WithOnNotAcquired` callback returns a non-nil error, the framework treats it as a cycle failure — for periodic workers, this triggers restart with backoff. Use `WithSkipOnNotAcquired` or return nil from the callback if you want to skip without restart.

The `Locker` interface:

```go
type Locker interface {
    Acquire(ctx context.Context, key string, ttl time.Duration) (bool, error)
    Release(ctx context.Context, key string) error
}
```

If your lock implementation already has these two methods with matching signatures, it satisfies `Locker` directly — no adapter needed.

Release uses `context.WithoutCancel` so that context cancellation does not prevent lock cleanup.

### Timeout

Enforces a per-cycle deadline. Distinct from `WithTimeout` (which controls graceful shutdown):

```go
middleware.Timeout(30 * time.Second)
```

### Slog

Structured log lines per cycle (start + end/error) via go-coldbrew/log. Pair with `LogContext()` to include worker name and attempt automatically:

```go
middleware.Slog()
```

### LogContext

Injects worker name and attempt into the log context so all log calls inside the worker automatically include them:

```go
middleware.LogContext()
```

### DefaultInterceptors

Convenience bundle for the standard observability stack:

```go
// Zero-config observability — one line
workers.Run(ctx, myWorkers,
    workers.WithInterceptors(middleware.DefaultInterceptors()...),
)

// Defaults + extras
workers.Run(ctx, myWorkers,
    workers.WithInterceptors(middleware.DefaultInterceptors()...),
    workers.AddInterceptors(middleware.Duration(observe)),
)
```

## WorkerInfo

Every handler receives a `*WorkerInfo` that carries worker metadata and child management:

| Method | Description |
|--------|-------------|
| `GetName() string` | Worker name |
| `GetAttempt() int` | Restart attempt (0 on first run) |
| `GetHandler() CycleHandler` | The worker's handler — use type assertion for handler-specific state |
| `Add(w *Worker) bool` | Add child worker — returns false if name already exists (no-op) |
| `Remove(name string)` | Stop child worker by name |
| `GetChildren() []string` | Names of running child workers (stopped children auto-pruned) |
| `GetChild(name string) (Worker, bool)` | Look up a child by name (returns a value copy) |
| `GetChildCount() int` | Number of running children (cheaper than `len(GetChildren())`) |

Use `Worker.GetName()`, `Worker.GetHandler()`, `Worker.GetInterval()`, and `Worker.GetRestartOnFail()` to inspect a child.

To replace a running worker, call `Remove` then `Add`. This is not atomic — there is a brief window where the worker is not running.

`context.Context` handles cancellation/deadlines/values. `*WorkerInfo` handles everything worker-specific.

## Helpers

### EveryInterval

Use the `Every` builder method to run a handler periodically:

```go
workers.NewWorker("metrics-reporter").HandlerFunc(reportMetrics).
    Every(30 * time.Second)
```

For manual control, `EveryInterval` wraps a handler in a timer loop directly:

```go
workers.NewWorker("metrics-reporter").HandlerFunc(workers.EveryInterval(
    30*time.Second, reportMetrics,
))
```

Both are equivalent. The builder form is preferred — it also supports `WithJitter` and `WithInitialDelay`.

### ChannelWorker

Consumes items from a channel one at a time:

```go
refreshChan := make(chan string, 100)

workers.NewWorker("refresher").HandlerFunc(workers.ChannelWorker(refreshChan,
    func(ctx context.Context, info *workers.WorkerInfo, driverID string) error {
        return refreshDriverProfile(ctx, driverID)
    },
))
```

### BatchChannelWorker

Collects items into batches, flushing when the batch reaches `maxSize` or `maxDelay` elapses since the first item:

```go
eventChan := make(chan Event, 1000)

workers.NewWorker("event-batcher").HandlerFunc(workers.BatchChannelWorker(eventChan,
    100,                    // max batch size
    500*time.Millisecond,   // max delay
    func(ctx context.Context, info *workers.WorkerInfo, batch []Event) error {
        return store.BulkInsert(ctx, batch)
    },
))
```

Partial batches are flushed on context cancellation (graceful shutdown). Both `ChannelWorker` and `BatchChannelWorker` return `ErrDoNotRestart` when the channel is closed, preventing restart loops on exhausted channels.

## Dynamic Workers

Workers can dynamically spawn and remove child workers using `WorkerInfo.Add`, `Remove`, and `GetChildren`. This is the pattern for config-driven worker pools (like database-driven solver workers):

```go
workers.NewWorker("pool-manager").HandlerFunc(func(ctx context.Context, info *workers.WorkerInfo) error {
    ticker := time.NewTicker(60 * time.Second)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err() // children stop automatically
        case <-ticker.C:
            desired := loadConfigsFromDB(ctx)

            running := map[string]bool{}
            for _, name := range info.GetChildren() {
                running[name] = true
            }

            // Remove workers no longer in config
            for name := range running {
                if _, ok := desired[name]; !ok {
                    info.Remove(name)
                }
            }

            // Add only workers that aren't already running
            for name, cfg := range desired {
                if !running[name] {
                    info.Add(workers.NewWorker(name).HandlerFunc(makeSolver(cfg)))
                }
            }
        }
    }
})
```

**Add is a no-op if the name exists** — it returns `false` without restarting the running worker. To replace a worker (e.g., on config change), call `Remove` then `Add`:

```go
info.Remove("solver")
info.Add(workers.NewWorker("solver").HandlerFunc(makeSolver(newCfg)))
```

Note: `Remove` + `Add` is not atomic — there is a brief window where the worker is not running.

**Automatic cleanup:** When a child permanently stops (see the [return value table](#handler-return-values) for what triggers permanent stop), it is automatically excluded from `GetChildren` and `GetChild`. The underlying [suture] supervisor is the source of truth — no manual cleanup needed. Note that there may be a brief delay between the child stopping and the change being visible, as stop events are processed asynchronously.

### Example: Config change detection via handler

Instead of maintaining a parallel map to track per-worker state (e.g., config versions), store metadata on your `CycleHandler` implementation and inspect it via `GetChild().GetHandler()` type assertion:

```go
type solverHandler struct {
    version int64
    cfg     SolverConfig
}

func (h *solverHandler) RunCycle(ctx context.Context, info *workers.WorkerInfo) error {
    return solve(ctx, h.cfg)
}

func (h *solverHandler) Close() error { return nil }
```

In the reconciler, detect config changes without a parallel tracking map:

```go
for key, desired := range desiredConfigs {
    child, exists := info.GetChild(key)
    if exists {
        if h, ok := child.GetHandler().(*solverHandler); ok && h.version == desired.version {
            continue // config unchanged, skip
        }
        info.Remove(key) // config changed, replace
    }
    info.Add(workers.NewWorker(key).Handler(&solverHandler{
        version: desired.version,
        cfg:     desired.cfg,
    }))
}
```

`GetChild()` returns a copy of the `Worker` struct, but the handler is stored as a `CycleHandler` interface — use type assertion to access handler-specific fields for change detection or metadata inspection.

### Example: Fixed children on startup

A worker that spawns N consumer goroutines when it starts:

```go
workers.NewWorker("consumer-pool").HandlerFunc(func(ctx context.Context, info *workers.WorkerInfo) error {
    for i := range 5 {
        name := fmt.Sprintf("consumer-%d", i)
        info.Add(workers.NewWorker(name).HandlerFunc(workers.ChannelWorker(eventChan, processEvent)))
    }
    <-ctx.Done()
    return ctx.Err() // all 5 consumers stop with parent
})
```

### Example: Per-tenant workers

Spawn a dedicated worker when a new tenant appears, remove it when the tenant is deactivated:

```go
workers.NewWorker("tenant-manager").HandlerFunc(func(ctx context.Context, info *workers.WorkerInfo) error {
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case event := <-tenantEvents:
            switch event.Type {
            case "activated":
                info.Add(workers.NewWorker("tenant:"+event.ID).
                    HandlerFunc(makeTenantWorker(event.ID)))
            case "deactivated":
                info.Remove("tenant:" + event.ID)
            }
        }
    }
})
```

### Example: Nested hierarchy

Children can spawn their own children — the supervisor tree goes as deep as needed:

```go
workers.NewWorker("region-manager").HandlerFunc(func(ctx context.Context, info *workers.WorkerInfo) error {
    for _, region := range []string{"us-east", "eu-west"} {
        info.Add(workers.NewWorker("region:"+region).HandlerFunc(
            func(ctx context.Context, info *workers.WorkerInfo) error {
                zones := fetchZones(ctx, region)
                for _, zone := range zones {
                    info.Add(workers.NewWorker("zone:"+zone).HandlerFunc(makeZoneWorker(zone)))
                }
                <-ctx.Done()
                return ctx.Err()
            },
        ))
    }
    <-ctx.Done()
    return ctx.Err()
})
// Tree: region-manager → region:us-east → zone:us-east-1a, zone:us-east-1b
//                       → region:eu-west → zone:eu-west-1a
```

When `region:us-east` stops, all its zone workers stop automatically (scoped lifecycle).

## Running Workers

### Multiple workers

```go
err := workers.Run(ctx, []*workers.Worker{w1, w2, w3})
```

`Run` blocks until `ctx` is cancelled and all workers have exited. A worker exiting early (without restart) does not stop other workers.

### Single worker

```go
workers.RunWorker(ctx, w)
```

`RunWorker` is a convenience for `workers.Run(ctx, []*workers.Worker{w})`. Unlike `Run`, it discards the error. Use `Run` if you need error handling.

## Graceful Shutdown

When the context passed to `Run` is cancelled:

1. All worker contexts are cancelled — handlers should return `ctx.Err()`
2. `BatchChannelWorker` flushes any partial batch before returning
3. `handler.Close()` is called exactly once (for `CycleHandler` implementations)
4. Children stop when their parent stops (scoped lifecycle)
5. `Run` returns nil

`WithTimeout(d)` controls how long suture waits for a worker to return after context cancellation. If a worker ignores cancellation and doesn't return within the timeout, suture logs a stop-timeout event and abandons the goroutine.

## Logging

Supervisor-level lifecycle events (panics, restarts, backoff, timeouts) are logged via stdlib `log/slog`. If your application configures `slog.SetDefault`, these events flow through your handler:

```json
{"level":"ERROR","msg":"worker panicked","worker":"my-worker","event":"..."}
{"level":"WARN","msg":"worker terminated","worker":"my-worker","event":"..."}
{"level":"WARN","msg":"worker backoff","event":"..."}
{"level":"INFO","msg":"worker resumed","event":"..."}
```

Per-cycle logging is available via the `middleware.Slog()` and `middleware.LogContext()` interceptors, which use `go-coldbrew/log` (a wrapper around `slog`). Since `go-coldbrew/log` calls `slog` under the hood, `slog.SetDefault` affects both layers.

## Metrics

Workers support pluggable metrics via the `Metrics` interface. Pass metrics at the root level — all workers and their children inherit them automatically.

### Built-in Prometheus metrics

```go
if err := workers.Run(ctx, myWorkers, workers.WithMetrics(workers.NewPrometheusMetrics("myapp"))); err != nil {
    slog.Error("workers failed", "error", err)
}
```

This registers the following metrics (auto-registered via `promauto`):

| Metric | Type | Description |
|--------|------|-------------|
| `myapp_worker_started_total{worker}` | Counter | Total worker starts |
| `myapp_worker_stopped_total{worker}` | Counter | Total worker stops |
| `myapp_worker_panicked_total{worker}` | Counter | Total worker panics |
| `myapp_worker_failed_total{worker}` | Counter | Total worker failures |
| `myapp_worker_restarted_total{worker}` | Counter | Total worker restarts |
| `myapp_worker_run_duration_seconds{worker}` | Histogram | Worker attempt lifetime (start to stop/failure) |
| `myapp_worker_active_count` | Gauge | Currently active workers |

`NewPrometheusMetrics` is safe to call multiple times with the same namespace — it returns the cached instance.

### No metrics (default)

```go
_ = workers.Run(ctx, myWorkers) // uses BaseMetrics{} (no-op) — zero overhead
```

### Custom metrics

Implement the `Metrics` interface for your own backend (Datadog, StatsD, etc.). Embed `BaseMetrics` for forward compatibility — new methods added to the interface get safe no-op defaults instead of breaking your build:

```go
type myDatadogMetrics struct {
    workers.BaseMetrics // forward-compatible — new methods get no-op defaults
    client *datadog.Client
}

func (m *myDatadogMetrics) WorkerStarted(name string) {
    m.client.Incr("worker.started", []string{"worker:" + name}, 1)
}

func (m *myDatadogMetrics) WorkerFailed(name string, err error) {
    m.client.Incr("worker.failed", []string{"worker:" + name}, 1)
}

// All other Metrics methods (Stopped, Panicked, Restarted, etc.)
// default to no-op via BaseMetrics.
```

### Per-worker override

Children inherit metrics from the root by default. Override for specific workers via the builder:

```go
workers.NewWorker("manager").HandlerFunc(func(ctx context.Context, info *workers.WorkerInfo) error {
    // This child uses custom metrics instead of the inherited root metrics.
    info.Add(workers.NewWorker("special").HandlerFunc(processSpecial).WithMetrics(datadogMetrics))
    <-ctx.Done()
    return ctx.Err()
})
```

## Testing

### Testing middleware

Use `NewWorkerInfo` to create a `*WorkerInfo` for unit-testing middleware without running the full supervisor:

```go
info := workers.NewWorkerInfo("test-worker", 0)
err := myMiddleware(ctx, info, func(ctx context.Context, info *workers.WorkerInfo) error {
    // assert middleware behavior
    return nil
})
```

### Testing with dynamic children

Use `WithTestChildren` to create a `WorkerInfo` that supports `Add`/`Remove`/`GetChildren`:

```go
ctx, cancel := context.WithCancel(context.Background())
defer cancel()

info := workers.NewWorkerInfo("manager", 0, workers.WithTestChildren(ctx))
info.Add(workers.NewWorker("child").HandlerFunc(childFn))
assert.Equal(t, []string{"child"}, info.GetChildren())
```

### Integration testing

Use `RunWorker` with a short-lived context:

```go
ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
defer cancel()
workers.RunWorker(ctx, myWorker)
// assert side effects
```

## Best Practices

- **Handler contract:** Long-running workers should block on `<-ctx.Done()`. Periodic workers should return quickly from each tick.
- **`WithRestart(false)` vs `ErrDoNotRestart`:** Use `WithRestart(false)` when a worker is unconditionally one-shot (known at build time). Use `ErrDoNotRestart` when the decision is made at runtime (e.g., channel closed, work exhausted).
- **Naming:** Use descriptive names. For hierarchical workers, use colons: `"region:us-east"`, `"tenant:abc123"`.
- **Middleware ordering:** The first middleware in the list is the outermost. Put `Recover` first (so it catches panics from all inner middleware), `Tracing` next, then domain-specific middleware.
- **Metrics inheritance:** Set metrics once at the `Run` level. Override per-worker only when you need separate dashboards.
- **Distributed locking:** Use `DistributedLock` for periodic workers that should run on only one pod. The lock is acquired per cycle, not per worker lifetime.

## ColdBrew Integration

The workers package is standalone — any Go service can use it directly via `workers.Run`. ColdBrew core also integrates workers into the service lifecycle via the [CBWorkerProvider] optional interface.

### How it works

Implement `Workers()` on your service to return worker definitions. ColdBrew discovers this at startup via type assertion and manages the workers alongside gRPC/HTTP servers:

```go
var _ core.CBWorkerProvider = (*cbSvc)(nil)

func (s *cbSvc) Workers() []*workers.Worker {
    return []*workers.Worker{
        workers.NewWorker("cleanup").
            HandlerFunc(s.cleanup).
            Every(5 * time.Minute).
            WithJitter(10),
    }
}
```

No changes to `main()` — `SetService` discovers the interface automatically.

### Lifecycle

```text
PreStart → initGRPC → initHTTP → start workers → start servers → PostStart
→ block → PreStop → FailCheck → drain → stop workers → stop servers → Stop → PostStop
```

Workers start before servers (can warm caches) and stop before servers stop (in-flight RPCs can still use worker-managed resources).

### Delegation pattern

In the [cookiecutter template], `cbSvc` in `main.go` is a thin adapter. Workers are defined in `service/service.go` where the business logic lives:

```go
// service/service.go — service owns its workers
func (s *svc) Workers() []*workers.Worker {
    return []*workers.Worker{
        workers.NewWorker("cleanup").HandlerFunc(s.cleanup).Every(5 * time.Minute),
    }
}

// main.go — adapter delegates via composite interface
type serviceImpl interface {
    Stop()
    Workers() []*workers.Worker
}

type cbSvc struct {
    impl serviceImpl
}

func (s *cbSvc) Workers() []*workers.Worker { return s.impl.Workers() }
```

### Metrics defaults

ColdBrew wires `workers.NewPrometheusMetrics(APP_NAME)` automatically when you adopt `CBWorkerProvider`. The default uses `APP_NAME` as the namespace, so `myapp_worker_started_total`, `myapp_worker_panicked_total`, `myapp_worker_active_count`, etc. appear on `/metrics` without any extra wiring.

The default is skipped when `DISABLE_PROMETHEUS=true` or `APP_NAME` is empty (an empty namespace would produce ambiguous unprefixed metric names).

To use a non-Prometheus backend (Datadog, StatsD, etc.) or a custom Prometheus namespace, override the default via `core.AddWorkerRunOptions` during init. The `Metrics` interface is the same one shown in the [standalone Metrics section](#metrics) earlier in this document:

```go
func init() {
    core.AddWorkerRunOptions(workers.WithMetrics(&myDatadogMetrics{client: dd}))
}
```

`AddWorkerRunOptions` also accepts other run-level options like `workers.WithDefaultJitter` and `workers.WithInterceptors` — anything that should apply framework-wide to every worker started by `core.Run()`. Per-worker `Worker.WithMetrics` still overrides the run-level default for individual workers.

### Tracing and observability middleware (opt-in)

Unlike gRPC, ColdBrew does **not** wire worker observability middleware automatically. The standard stack (`Recover`, `LogContext`, `Tracing`, `Slog`) is opt-in because tracing and slog produce one span and one log line per cycle — fine for slow periodic workers, noisy for fast ones. Enable it explicitly:

```go
import "github.com/go-coldbrew/workers/middleware"

func init() {
    core.AddWorkerRunOptions(
        workers.WithInterceptors(middleware.DefaultInterceptors()...),
    )
}
```

`DefaultInterceptors()` returns `[Recover, LogContext, Tracing, Slog]`. Pick a subset if some are too noisy for your workload — `middleware.Recover(nil)` and `middleware.LogContext()` are essentially free and recommended for any production service:

```go
core.AddWorkerRunOptions(
    workers.WithInterceptors(
        middleware.Recover(nil),
        middleware.LogContext(),
    ),
)
```

Run-level interceptors wrap **outside** worker-level interceptors, so per-worker `Interceptors`/`AddInterceptors` still compose correctly. See the [Middleware section](#middleware) earlier in this document for individual middleware behaviour.

### Alternative: workers.Run() directly

The workers package is standalone — you can call `workers.Run()` from anywhere in your service or implementation. It works in any goroutine, any function, any context. The workers will stop when the context is cancelled.

```go
go func() {
    if err := workers.Run(ctx, []*workers.Worker{
        workers.NewWorker("cleanup").HandlerFunc(s.cleanup).Every(5 * time.Minute),
    }); err != nil {
        slog.Error("workers failed", "error", err)
    }
}()
```

**When to use which:**

| Approach | Shutdown ordering | Framework-managed | Best for |
|---|---|---|---|
| `CBWorkerProvider` | Workers stop before servers (guaranteed) | Yes | Production services with workers tied to the service lifecycle |
| `workers.Run()` directly | Stops when context cancelled | No — you manage it | Standalone workers, quick prototyping, workers outside the service lifecycle |

### Readiness

Workers and readiness are independent concerns. See [Readiness Patterns] for how to combine workers with health checks — from simple (Pattern 1) to worker-managed readiness (Pattern 3) to dynamic DB-driven workers (Pattern 4).

[CBWorkerProvider]: https://pkg.go.dev/github.com/go-coldbrew/core#CBWorkerProvider
[cookiecutter template]: /cookiecutter-reference
[Readiness Patterns]: /howto/readiness

[workers]: https://github.com/go-coldbrew/workers
[suture]: https://github.com/thejerf/suture
[tracing]: https://github.com/go-coldbrew/tracing
[Log]: https://github.com/go-coldbrew/log
