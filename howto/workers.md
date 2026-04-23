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

[workers] is a worker lifecycle library that manages background goroutines with automatic panic recovery, configurable restart with backoff, tracing, and structured shutdown. It is built on top of [suture], an Erlang-inspired supervisor tree library for Go.

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
- **Tracing** — each worker execution gets an OTEL span via [tracing]
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
)

ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
defer cancel()

if err := workers.Run(ctx, []*workers.Worker{
    workers.NewWorker("kafka", consume),
    workers.NewWorker("cleanup", cleanup).Every(5 * time.Minute).WithRestart(true),
}); err != nil {
    log.Fatal(err)
}
```

`Run` blocks until `ctx` is cancelled and all workers have exited.

## Creating Workers

Use `NewWorker` with a name and a run function. The run function receives a `WorkerContext` (which extends `context.Context`) and should block until the context is cancelled or an error occurs:

```go
w := workers.NewWorker("my-worker", func(ctx workers.WorkerContext) error {
    log.Info(ctx, "msg", "started")
    // Worker name and attempt are automatically added to the log context
    // by the framework — all log calls using this ctx include them.
    <-ctx.Done()
    return ctx.Err()
})
```

## Builder Methods

| Method | Description | Default |
|--------|-------------|---------|
| `WithRestart(true)` | Restart on failure with backoff | `false` (exit on error) |
| `Every(duration)` | Run periodically on a fixed interval | — |
| `WithJitter(percent)` | Randomize tick interval by ±percent (requires `Every`) | — |
| `WithInitialDelay(d)` | Delay first tick (requires `Every`) | — |
| `Use(mw...)` | Attach middleware to the worker | — |
| `WithFailureBackoff(d)` | Duration between restarts | 15s (suture default) |
| `WithFailureThreshold(n)` | Max failures before giving up | 5 (suture default) |
| `WithFailureDecay(r)` | Rate failures decay per second | 1.0 (suture default) |
| `WithBackoffJitter(j)` | Random jitter on restart backoff | — |
| `WithTimeout(d)` | Max time to wait for graceful stop | 10s (suture default) |

Example with full configuration:

```go
workers.NewWorker("resilient-consumer", consume).
    WithRestart(true).
    Every(15 * time.Second).
    WithJitter(10).
    WithInitialDelay(5 * time.Second).
    Use(middleware.Recover(onPanic), middleware.Tracing()).
    WithFailureBackoff(5 * time.Second).
    WithFailureThreshold(10).
    WithTimeout(30 * time.Second)
```

## Jitter

When many workers share the same base interval (e.g. 15s), they synchronize and spike downstream services — the [thundering herd](https://en.wikipedia.org/wiki/Thundering_herd_problem) problem. Jitter desynchronizes ticks by randomizing each interval within a configurable range.

### Per-worker jitter

```go
workers.NewWorker("poller", poll).
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
workers.NewWorker("poller", poll).
    Every(15 * time.Second).
    WithJitter(10).
    WithInitialDelay(5 * time.Second)
```

### Direct helper

For manual use without the builder pattern:

```go
fn := workers.EveryIntervalWithJitter(15*time.Second, 10, pollFn)
w := workers.NewWorker("poller", fn)
```

## Middleware

Middleware wraps each worker execution cycle with cross-cutting concerns like panic recovery, tracing, distributed locking, and timing. For periodic workers (`Every`), middleware runs on every tick, not once for the worker lifetime.

### Types

```go
// CycleHandler handles worker execution cycles.
// Implement as a struct for middleware with lifecycle needs.
type CycleHandler interface {
    RunCycle(ctx context.Context, info *WorkerInfo) error
    Close() error  // called once when the worker stops
}

// CycleFunc adapts a plain function into a CycleHandler.
// Close is a no-op — use this for simple, stateless middleware.
type CycleFunc func(ctx context.Context, info *WorkerInfo) error

// Middleware wraps a CycleHandler, returning a new CycleHandler.
type Middleware func(next CycleHandler) CycleHandler
```

`*WorkerInfo` is passed as an explicit parameter — middleware always has access to the worker name and attempt without needing `FromContext`. The `Close()` method is called once when the worker stops, allowing middleware to flush buffers or release resources.

### Worker-level middleware

```go
w := workers.NewWorker("solver", solve).
    Every(15 * time.Second).
    Use(
        middleware.Recover(onPanic),
        middleware.Tracing(),
        middleware.Duration(observeDuration),
    )
```

The first middleware in the list is the outermost wrapper (runs first on entry, last on exit), matching the gRPC interceptor convention.

### Run-level middleware

`WithMiddleware` applies default middleware to all workers. Run-level middleware wraps **outside** worker-level middleware, so shared concerns like tracing are always outermost:

```go
workers.Run(ctx, myWorkers,
    workers.WithMiddleware(middleware.Tracing(), middleware.Slog()),
)
```

Effective chain: `run-level middleware → worker-level middleware → CycleHandler`

### Writing custom middleware

Middleware wraps a `CycleHandler` and returns a new `CycleHandler`. The `*WorkerInfo` parameter gives you the worker name and attempt number explicitly — no hidden context lookups:

```go
func LogCycle(next workers.CycleHandler) workers.CycleHandler {
    return workers.CycleFunc(func(ctx context.Context, info *workers.WorkerInfo) error {
        log.Info(ctx, "msg", "cycle start", "worker", info.Name)
        err := next.RunCycle(ctx, info)
        log.Info(ctx, "msg", "cycle end", "worker", info.Name, "error", err)
        return err
    })
}
```

For middleware that needs cleanup, implement `CycleHandler` as a struct:

```go
type bufferedLogger struct {
    next   workers.CycleHandler
    buffer []string
}

func (b *bufferedLogger) RunCycle(ctx context.Context, info *workers.WorkerInfo) error {
    b.buffer = append(b.buffer, info.Name)
    return b.next.RunCycle(ctx, info)
}

func (b *bufferedLogger) Close() error {
    // Flush buffer on worker stop
    return flush(b.buffer)
}
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

### Recover

Catches panics in the worker cycle and converts them to errors. The panic does not propagate:

```go
middleware.Recover(func(name string, v any) {
    alerting.Send(fmt.Sprintf("worker %s panicked: %v", name, v))
})
```

### Tracing

Creates an OTEL span named `worker:<name>:cycle` for each tick. Sets `worker.name` tag and records errors:

```go
middleware.Tracing()
```

This is distinct from the per-worker-lifetime span created by the framework — each tick gets its own trace span, making cycle-level latency visible.

### Duration

Measures wall-clock time and calls a callback. Building block for custom metrics:

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

## WorkerContext

Every worker's run function receives a `WorkerContext` that extends `context.Context`:

```go
type WorkerContext interface {
    context.Context
    Name() string        // worker name
    Attempt() int        // restart attempt (0 on first run)
    Add(w *Worker)       // add/replace child worker by name
    Remove(name string)  // stop child worker by name
    Children() []string  // names of running child workers
}
```

Since `WorkerContext` embeds `context.Context`, it passes anywhere a `ctx` is expected — logging, database calls, HTTP requests, gRPC calls all work transparently.

## Helpers

### EveryInterval

Wraps a function in a ticker loop:

```go
workers.NewWorker("metrics-reporter", workers.EveryInterval(
    30*time.Second,
    func(ctx workers.WorkerContext) error {
        return reportMetrics(ctx)
    },
)).WithRestart(true)
```

Or use the builder shorthand:

```go
workers.NewWorker("metrics-reporter", reportMetrics).Every(30 * time.Second).WithRestart(true)
```

### ChannelWorker

Consumes items from a channel one at a time:

```go
refreshChan := make(chan string, 100)

workers.NewWorker("refresher", workers.ChannelWorker(refreshChan,
    func(ctx workers.WorkerContext, driverID string) error {
        return refreshDriverProfile(ctx, driverID)
    },
))
```

### BatchChannelWorker

Collects items into batches, flushing when the batch reaches `maxSize` or `maxDelay` elapses since the first item:

```go
eventChan := make(chan Event, 1000)

workers.NewWorker("event-batcher", workers.BatchChannelWorker(eventChan,
    100,                    // max batch size
    500*time.Millisecond,   // max delay
    func(ctx workers.WorkerContext, batch []Event) error {
        return store.BulkInsert(ctx, batch)
    },
)).WithRestart(true)
```

Partial batches are flushed on context cancellation (graceful shutdown).

## Dynamic Workers

Workers can dynamically spawn and remove child workers using `WorkerContext.Add`, `Remove`, and `Children`. This is the pattern for config-driven worker pools (like database-driven solver workers):

```go
workers.NewWorker("pool-manager", func(ctx workers.WorkerContext) error {
    ticker := time.NewTicker(60 * time.Second)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err() // children stop automatically
        case <-ticker.C:
            desired := loadConfigsFromDB(ctx)

            // Remove workers no longer in config
            for _, name := range ctx.Children() {
                if _, ok := desired[name]; !ok {
                    ctx.Remove(name)
                }
            }

            // Add/replace desired workers
            for name, cfg := range desired {
                ctx.Add(workers.NewWorker(name, makeSolver(cfg)).WithRestart(true))
            }
        }
    }
}).WithRestart(true)
```

**Replace semantics:** calling `Add` with a name that already exists stops the old worker and starts the new one. This handles config updates naturally.

### Example: Fixed children on startup

A worker that spawns N consumer goroutines when it starts:

```go
workers.NewWorker("consumer-pool", func(ctx workers.WorkerContext) error {
    for i := 0; i < 5; i++ {
        name := fmt.Sprintf("consumer-%d", i)
        ctx.Add(workers.NewWorker(name, workers.ChannelWorker(eventChan, processEvent)))
    }
    <-ctx.Done()
    return ctx.Err() // all 5 consumers stop with parent
})
```

### Example: Per-tenant workers

Spawn a dedicated worker when a new tenant appears, remove it when the tenant is deactivated:

```go
workers.NewWorker("tenant-manager", func(ctx workers.WorkerContext) error {
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case event := <-tenantEvents:
            switch event.Type {
            case "activated":
                ctx.Add(workers.NewWorker("tenant:"+event.ID,
                    makeTenantWorker(event.ID)).WithRestart(true))
            case "deactivated":
                ctx.Remove("tenant:" + event.ID)
            }
        }
    }
}).WithRestart(true)
```

### Example: Nested hierarchy

Children can spawn their own children — the supervisor tree goes as deep as needed:

```go
workers.NewWorker("region-manager", func(ctx workers.WorkerContext) error {
    for _, region := range []string{"us-east", "eu-west"} {
        region := region
        ctx.Add(workers.NewWorker("region:"+region, func(ctx workers.WorkerContext) error {
            // Each region spawns its own zone workers
            zones := fetchZones(ctx, region)
            for _, zone := range zones {
                ctx.Add(workers.NewWorker("zone:"+zone, makeZoneWorker(zone)))
            }
            <-ctx.Done()
            return ctx.Err()
        }))
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

Worker lifecycle events (panics, restarts, backoff, timeouts) are logged via [go-coldbrew/log][Log]:

```json
{"level":"error","msg":"worker panicked","worker":"my-worker","event":"..."}
{"level":"warning","msg":"worker terminated","worker":"my-worker","event":"..."}
{"level":"warning","msg":"worker backoff","event":"..."}
{"level":"info","msg":"worker resumed","event":"..."}
```

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
| `myapp_worker_run_duration_seconds{worker}` | Histogram | Duration of worker run cycles |
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

Children inherit metrics from the root by default. Override for specific workers via the builder. Use `WorkerContext.Add` inside a manager worker:

```go
workers.NewWorker("manager", func(ctx workers.WorkerContext) error {
    // This child uses custom metrics instead of the inherited root metrics.
    ctx.Add(workers.NewWorker("special", fn).WithMetrics(customMetrics))
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
