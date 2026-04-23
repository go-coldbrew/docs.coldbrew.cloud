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
│   ├── Worker-A run func
│   ├── Child-A1 (added dynamically)
│   └── Child-A2
└── Worker-B supervisor
    └── Worker-B run func
```

**Key properties:**
- **Scoped lifecycle** — when a parent stops, all its children stop
- **Independent restart** — each worker restarts independently with exponential backoff
- **Panic recovery** — panics are caught and converted to errors by suture
- **Composable middleware** — tracing, logging, locking, and timing as interceptors
- **Jitter** — desynchronize periodic workers to prevent thundering herd
- **Dynamic children** — workers can spawn/remove child workers at runtime

## Quick Start

```go
import (
    "context"
    "log"
    "os"
    "os/signal"
    "time"

    "github.com/go-coldbrew/workers"
    "github.com/go-coldbrew/workers/middleware"
)

ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
defer cancel()

if err := workers.Run(ctx, []*workers.Worker{
    workers.NewWorker("kafka").HandlerFunc(consume),
    workers.NewWorker("cleanup").HandlerFunc(cleanup).
        Every(5 * time.Minute).WithJitter(10).WithRestart(true),
},
    workers.WithInterceptors(middleware.DefaultInterceptors()...),
); err != nil {
    log.Fatal(err)
}
```

`Run` blocks until `ctx` is cancelled and all workers have exited.

## Creating Workers

Use `NewWorker` with a name, then set a handler via `HandlerFunc` (for plain functions) or `Handler` (for structs with cleanup):

```go
// Simple function handler (common case)
w := workers.NewWorker("my-worker").HandlerFunc(func(ctx context.Context, info *workers.WorkerInfo) error {
    log.Info(ctx, "msg", "started", "worker", info.Name(), "attempt", info.Attempt())
    <-ctx.Done()
    return ctx.Err()
})

// Struct handler with cleanup (for resources like DB connections)
w := workers.NewWorker("batch").Handler(&batchProcessor{db: db}).
    Every(30 * time.Second)
```

The handler receives a `context.Context` for cancellation and a `*WorkerInfo` for worker metadata.

## Builder Methods

| Method | Description | Default |
|--------|-------------|---------|
| `HandlerFunc(fn)` | Set handler from a plain function | — |
| `Handler(h)` | Set handler from a `CycleHandler` struct | — |
| `WithRestart(true)` | Restart on failure with backoff | `false` (exit on error) |
| `Every(duration)` | Run periodically on a fixed interval | — |
| `WithJitter(percent)` | Randomize tick interval by ±percent (requires `Every`) | inherit run-level |
| `WithInitialDelay(d)` | Delay first tick (requires `Every`) | — |
| `Interceptors(mw...)` | Replace worker-level middleware | — |
| `AddInterceptors(mw...)` | Append to worker-level middleware | — |
| `WithFailureBackoff(d)` | Duration between restarts | 15s (suture default) |
| `WithFailureThreshold(n)` | Max failures before giving up | 5 (suture default) |
| `WithFailureDecay(r)` | Rate failures decay per second | 1.0 (suture default) |
| `WithBackoffJitter(j)` | Random jitter on restart backoff | — |
| `WithTimeout(d)` | Max time to wait for graceful stop | 10s (suture default) |

Example with full configuration:

```go
workers.NewWorker("resilient-consumer").HandlerFunc(consume).
    WithRestart(true).
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
```
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

`WithInterceptors` applies default middleware to all workers. Run-level middleware wraps **outside** worker-level middleware, so shared concerns like tracing are always outermost:

```go
workers.Run(ctx, myWorkers,
    workers.WithInterceptors(middleware.DefaultInterceptors()...),
)
```

Effective chain: `run-level middleware → worker-level middleware → handler`

### Writing custom middleware

Middleware is a flat function that calls `next` to continue the chain. The `*WorkerInfo` parameter gives you the worker name and attempt explicitly — no hidden context lookups:

```go
func myLogging(ctx context.Context, info *workers.WorkerInfo, next workers.CycleFunc) error {
    log.Info(ctx, "msg", "cycle start", "worker", info.Name())
    err := next(ctx, info)
    log.Info(ctx, "msg", "cycle end", "worker", info.Name(), "error", err)
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
| `Slog()` | Structured log line per cycle via go-coldbrew/log |
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

Creates an OTEL span named `worker:<name>:cycle` for each tick. Records errors on the span:

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
        log.Info(ctx, "msg", "lock held, skipping", "worker", name)
        return nil
    }),
)
```

The `Locker` interface:

```go
type Locker interface {
    Acquire(ctx context.Context, key string, ttl time.Duration) (bool, error)
    Release(ctx context.Context, key string) error
}
```

Release uses `context.WithoutCancel` so that context cancellation does not prevent lock cleanup.

### Timeout

Enforces a per-cycle deadline. Distinct from `WithTimeout` (which controls graceful shutdown):

```go
middleware.Timeout(30 * time.Second)
```

### Slog

Structured log line per cycle via go-coldbrew/log. Logs at Info on success, Error on failure:

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

```go
func (info *WorkerInfo) Name() string              // worker name
func (info *WorkerInfo) Attempt() int              // restart attempt (0 on first run)
func (info *WorkerInfo) Add(w *Worker)             // add/replace child worker by name
func (info *WorkerInfo) Remove(name string)        // stop child worker by name
func (info *WorkerInfo) Children() []string         // names of running child workers
func (info *WorkerInfo) Child(name string) (Worker, bool) // look up a child by name
```

`Child` returns a value copy — safe for inspection, mutations have no effect on the running worker. Use `Worker.GetHandler()` and `Worker.GetName()` to inspect the child.

`context.Context` handles cancellation/deadlines/values. `*WorkerInfo` handles everything worker-specific.

## Helpers

### EveryInterval

Wraps a function in a timer loop:

```go
workers.NewWorker("metrics-reporter").HandlerFunc(workers.EveryInterval(
    30*time.Second,
    func(ctx context.Context, info *workers.WorkerInfo) error {
        return reportMetrics(ctx)
    },
)).WithRestart(true)
```

Or use the builder shorthand:

```go
workers.NewWorker("metrics-reporter").HandlerFunc(reportMetrics).
    Every(30 * time.Second).WithRestart(true)
```

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
)).WithRestart(true)
```

Partial batches are flushed on context cancellation (graceful shutdown).

## Dynamic Workers

Workers can dynamically spawn and remove child workers using `WorkerInfo.Add`, `Remove`, and `Children`. This is the pattern for config-driven worker pools (like database-driven solver workers):

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

            // Remove workers no longer in config
            for _, name := range info.Children() {
                if _, ok := desired[name]; !ok {
                    info.Remove(name)
                }
            }

            // Add/replace desired workers
            for name, cfg := range desired {
                info.Add(workers.NewWorker(name).HandlerFunc(makeSolver(cfg)).WithRestart(true))
            }
        }
    }
}).WithRestart(true)
```

**Replace semantics:** calling `Add` with a name that already exists stops the old worker and starts the new one. This handles config updates naturally.

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
                    HandlerFunc(makeTenantWorker(event.ID)).WithRestart(true))
            case "deactivated":
                info.Remove("tenant:" + event.ID)
            }
        }
    }
}).WithRestart(true)
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

`RunWorker` is a convenience for `workers.Run(ctx, []*workers.Worker{w})`. Useful for dynamic managers spawning children in goroutines.

## Logging

Worker lifecycle events (panics, restarts, backoff, timeouts) are logged via `log/slog`:

```json
{"level":"ERROR","msg":"worker panicked","worker":"my-worker","event":"..."}
{"level":"WARN","msg":"worker terminated","worker":"my-worker","event":"..."}
{"level":"WARN","msg":"worker backoff","event":"..."}
{"level":"INFO","msg":"worker resumed","event":"..."}
```

Per-cycle logging is available via the `middleware.Slog()` and `middleware.LogContext()` interceptors.

## Metrics

Workers support pluggable metrics via the `Metrics` interface. Pass metrics at the root level — all workers and their children inherit them automatically.

### Built-in Prometheus metrics

```go
if err := workers.Run(ctx, myWorkers, workers.WithMetrics(workers.NewPrometheusMetrics("myapp"))); err != nil {
    log.Fatal(err)
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
    info.Add(workers.NewWorker("special").HandlerFunc(fn).WithMetrics(customMetrics))
    <-ctx.Done()
    return ctx.Err()
})
```

## ColdBrew Integration (Phase 2)

The workers package is standalone — any Go service can use it. ColdBrew integration via `CBServiceV2` is planned for a future core release, where workers will be started/stopped as part of the ColdBrew service lifecycle.

[workers]: https://github.com/go-coldbrew/workers
[suture]: https://github.com/thejerf/suture
[tracing]: https://github.com/go-coldbrew/tracing
[Log]: https://github.com/go-coldbrew/log
