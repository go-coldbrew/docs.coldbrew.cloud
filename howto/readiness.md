---
layout: default
title: "Readiness Patterns"
parent: "How To"
nav_order: 16
description: "Readiness patterns for ColdBrew services: simple, PreStart-blocked, worker-managed, and dynamic workers with DB-driven config."
---
## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

## Overview

Readiness is a service-level concern. ColdBrew provides the primitives ([CBGracefulStopper], [CBPreStarter], [CBWorkerProvider]) and your service decides when it is ready to accept traffic. Kubernetes readiness probes respect this — traffic is only routed to pods that report `SERVING`.

This page describes four common patterns, from simplest to most advanced.

## Pattern 1: Simple (most services)

Service becomes ready immediately after `InitGRPC`. No workers, no external dependencies to wait for.

```go
type svc struct {
    *health.Server
}

func (s *svc) InitGRPC(ctx context.Context, server *grpc.Server) error {
    pb.RegisterMyServiceServer(server, s)
    return nil
}
```

In the [cookiecutter template], readiness is managed via `SetReady()` / `SetNotReady()`:

```go
func New(cfg config.Config) (*svc, error) {
    s := &svc{Server: GetHealthCheckServer()}
    SetReady() // service starts accepting traffic
    return s, nil
}
```

Graceful shutdown calls `FailCheck(true)`, which calls `SetNotReady()`. Kubernetes stops routing new requests during the drain period.

**When to use:** Services with no background workers or external dependencies that must be established before serving.

## Pattern 2: Block in PreStart

Use when a dependency (database, message broker, cache) **must** be ready before accepting traffic. [CBPreStarter] blocks server startup until `PreStart` returns.

```go
var _ core.CBPreStarter = (*cbSvc)(nil)

func (s *cbSvc) PreStart(ctx context.Context) error {
    // Servers won't start until this returns.
    // Returning an error aborts startup entirely.
    db, err := sql.Open("postgres", os.Getenv("DATABASE_URL"))
    if err != nil {
        return fmt.Errorf("database connect: %w", err)
    }
    if err := db.PingContext(ctx); err != nil {
        return fmt.Errorf("database ping: %w", err)
    }
    s.db = db
    return nil
}
```

`PreStart` runs before `initGRPC` / `initHTTP`, so you can also configure interceptors here:

```go
func (s *cbSvc) PreStart(ctx context.Context) error {
    interceptors.SetDefaultTimeout(30 * time.Second)
    auth.Setup(ctx, config.Get().AuthConfig)
    return nil
}
```

**When to use:** Database connections, message broker connections, mandatory cache warmup, auth interceptor registration. If the dependency fails to connect, the service should not start.

## Pattern 3: Worker-managed readiness

Use when workers can start independently and the service becomes ready once workers report in. Servers start immediately but the health check returns `NOT_SERVING` until all components are ready.

```go
var (
    _ core.CBWorkerProvider  = (*cbSvc)(nil)
    _ core.CBGracefulStopper = (*cbSvc)(nil)
)

type svc struct {
    *health.Server
    kafkaReady atomic.Bool
    cacheReady atomic.Bool
}

func (s *svc) Workers() []*workers.Worker {
    return []*workers.Worker{
        workers.NewWorker("kafka").HandlerFunc(s.consumeKafka),
        workers.NewWorker("cache-warmer").
            HandlerFunc(s.warmCache).
            Every(5 * time.Minute),
    }
}

func (s *svc) consumeKafka(ctx context.Context, info *workers.WorkerInfo) error {
    consumer, err := kafka.Connect(ctx, s.brokers)
    if err != nil {
        return err // triggers worker restart with backoff
    }
    s.kafkaReady.Store(true)
    defer s.kafkaReady.Store(false)
    return consumer.Consume(ctx)
}

func (s *svc) warmCache(ctx context.Context, info *workers.WorkerInfo) error {
    if err := s.cache.WarmAll(ctx); err != nil {
        return err
    }
    s.cacheReady.Store(true)
    return nil
}
```

The health check aggregates readiness from all components:

```go
func (s *svc) ReadyCheck(ctx context.Context, _ *emptypb.Empty) (*httpbody.HttpBody, error) {
    if s.kafkaReady.Load() && s.cacheReady.Load() {
        return readyResponse, nil
    }
    return notReadyResponse, ErrNotReady
}
```

During graceful shutdown, `FailCheck(true)` forces `NOT_SERVING` regardless of worker state:

```go
func (s *svc) FailCheck(fail bool) {
    if fail {
        s.kafkaReady.Store(false)
        s.cacheReady.Store(false)
    }
}
```

**When to use:** Services that can start the gRPC/HTTP servers while background workers are still initializing. Kubernetes readiness probes hold traffic until all components report ready.

## Pattern 4: Dynamic workers from DB

Use the manager pattern — one static worker reconciles dynamic children from an external source (database, config service, feature flags).

```go
func (s *svc) Workers() []*workers.Worker {
    return []*workers.Worker{
        workers.NewWorker("reconciler").
            HandlerFunc(s.reconcileWorkers).
            Every(30 * time.Second),
    }
}

func (s *svc) reconcileWorkers(ctx context.Context, info *workers.WorkerInfo) error {
    configs, err := s.db.GetWorkerConfigs(ctx)
    if err != nil {
        return err
    }

    // Add new workers from DB
    for _, cfg := range configs {
        if info.GetChild(cfg.Name) == nil {
            info.Add(
                workers.NewWorker(cfg.Name).
                    HandlerFunc(cfg.BuildHandler(s.deps)).
                    Every(cfg.Interval).
                    WithJitter(10),
            )
        }
    }

    // Remove workers no longer in DB
    for _, name := range info.GetChildren() {
        if !existsInConfigs(name, configs) {
            info.Remove(name)
        }
    }
    return nil
}
```

When the reconciler stops (parent shutdown), all dynamic children stop automatically — scoped lifecycle via the [suture] supervisor tree.

For readiness, combine with Pattern 3: the reconciler sets a ready flag after the first successful reconciliation.

**When to use:** Multi-tenant workers, feature-flagged background jobs, queue-per-customer patterns. See [Dynamic Workers] in the workers howto for the full API.

## Choosing a Pattern

| Pattern | Blocks startup? | Workers? | Complexity |
|---------|----------------|----------|------------|
| **Simple** | No | No | Trivial |
| **PreStart** | Yes | Optional | Low |
| **Worker-managed** | No | Yes | Medium |
| **Dynamic** | No | Yes (dynamic) | Higher |

Most services start with Pattern 1 or 2. Add Pattern 3 when you introduce background workers that affect readiness. Pattern 4 is for advanced multi-tenant or config-driven scenarios.

## Related

- [Workers] — full workers howto (middleware, jitter, dynamic children, metrics)
- [Shutdown Lifecycle] — how ColdBrew handles SIGTERM, FailCheck, drain period
- [Production Checklist] — readiness probes, resource limits, HPA configuration

[CBGracefulStopper]: https://pkg.go.dev/github.com/go-coldbrew/core#CBGracefulStopper
[CBPreStarter]: https://pkg.go.dev/github.com/go-coldbrew/core#CBPreStarter
[CBWorkerProvider]: https://pkg.go.dev/github.com/go-coldbrew/core#CBWorkerProvider
[cookiecutter template]: /cookiecutter-reference
[Workers]: /howto/workers
[Dynamic Workers]: /howto/workers#dynamic-workers
[Shutdown Lifecycle]: /howto/signals
[Production Checklist]: /howto/production
[suture]: https://github.com/thejerf/suture
