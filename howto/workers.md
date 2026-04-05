---
layout: default
title: "Workers"
parent: "How To"
description: "How to use go-coldbrew/workers to manage background goroutines with panic recovery, restart, and structured shutdown."
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
| `Every(duration)` | Wrap in a periodic ticker loop | — |
| `WithFailureBackoff(d)` | Duration between restarts | 15s (suture default) |
| `WithFailureThreshold(n)` | Max failures before giving up | 5 (suture default) |
| `WithFailureDecay(r)` | Rate failures decay per second | 1.0 (suture default) |
| `WithBackoffJitter(j)` | Random jitter on backoff | — |
| `WithTimeout(d)` | Max time to wait for graceful stop | 10s (suture default) |

Example with full configuration:

```go
workers.NewWorker("resilient-consumer", consume).
    WithRestart(true).
    WithFailureBackoff(5 * time.Second).
    WithFailureThreshold(10).
    WithTimeout(30 * time.Second)
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
