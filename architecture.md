---
layout: default
title: "Architecture"
nav_order: 5
description: "ColdBrew architecture: request lifecycle, interceptor chain, and package dependencies"
permalink: /architecture
---
# Architecture
{: .no_toc }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Design Principles

ColdBrew follows [12-factor app](https://12factor.net/) methodology and is designed to run on Kubernetes from day one:

| 12-Factor Principle | How ColdBrew Implements It |
|--------------------|-----------------------------|
| **Config** | All configuration via environment variables ([envconfig](https://github.com/kelseyhightower/envconfig)) — no config files, no YAML. See [Configuration Reference](/config-reference) |
| **Port binding** | Self-contained HTTP (`:9091`) and gRPC (`:9090`) servers, no external app server needed |
| **Logs** | Structured JSON to stdout by default — ready for any log aggregator (Fluentd, Loki, CloudWatch) |
| **Disposability** | Graceful SIGTERM handling with configurable drain periods. See [Signals](/howto/signals) |
| **Dev/prod parity** | Same binary, same config mechanism, same observability in every environment |
| **Concurrency** | Stateless processes — scale horizontally by adding replicas |
| **Backing services** | External dependencies (databases, caches, queues) attached via environment variables |

ColdBrew is **Kubernetes-native**: health/ready probe endpoints, Prometheus metrics scraping, graceful pod termination, and structured logging work without any additional setup. See the [Production Deployment guide](/howto/production) for K8s manifests and configuration.

## Overview

ColdBrew is a layered framework where each layer is an independent Go module. The `core` package orchestrates everything, but you can use any package standalone.

## Package Dependency Graph

```
                    ┌──────────────────┐
                    │       core       │
                    └────────┬─────────┘
                             │
                    ┌────────┴─────────┐
               ┌────┤   interceptors   ├────┐
               │    └────────┬─────────┘    │
               │             │              │
        ┌──────┴──────┐  ┌──┴───┐  ┌───────┴───────┐
        │ data-builder │  │ grpc │  │    tracing     │
        └──────┬──────┘  │ pool │  └───────┬───────┘
               │         └──┬───┘          │
               │            │              │
               │         ┌──┴───┐          │
               │         │  log ├──────────┘
               │         └──┬───┘
               │            │
               │      ┌─────┴──────┐
               │      │   errors   │
               │      └─────┬──────┘
               │            │
               └────────┬───┘
                   ┌────┴─────┐
                   │  options  │
                   └──────────┘
```

**Dependency order (bottom to top):**
```
options → errors → log → tracing → grpcpool → interceptors → data-builder → core
```

Each package only depends on packages below it. This means you can use `errors` without pulling in `tracing`, or use `log` without needing `interceptors`.

## Request Lifecycle

When a request arrives at a ColdBrew service, it flows through several layers:

```
  Client Request
       │
       ▼
  ┌─────────────────────────────────────────────────┐
  │                   ColdBrew Core                  │
  │                                                  │
  │  ┌──────────────┐       ┌──────────────┐        │
  │  │  HTTP Gateway │       │  gRPC Server │        │
  │  │  (grpc-gw)   │──────►│  (port 9090) │        │
  │  │  (port 9091) │       └──────┬───────┘        │
  │  └──────────────┘              │                 │
  │                                ▼                 │
  │  ┌──────────────────────────────────────────┐   │
  │  │          Server Interceptor Chain         │   │
  │  │                                           │   │
  │  │  1. Response Time Logging                 │   │
  │  │  2. Trace ID Injection                    │   │
  │  │  3. Context Tags (grpc_ctxtags)           │   │
  │  │  4. OpenTracing / OpenTelemetry           │   │
  │  │  5. Prometheus Metrics                    │   │
  │  │  6. Error Notification (Sentry/Rollbar)   │   │
  │  │  7. New Relic Transaction                 │   │
  │  │  8. Panic Recovery                        │   │
  │  │                                           │   │
  │  └────────────────────┬─────────────────────┘   │
  │                       │                          │
  │                       ▼                          │
  │              ┌─────────────────┐                 │
  │              │  Your Handler   │                 │
  │              │  (service.go)   │                 │
  │              └─────────────────┘                 │
  │                                                  │
  │  Built-in Endpoints:                             │
  │    /metrics        - Prometheus                  │
  │    /healthcheck    - Liveness probe              │
  │    /readycheck     - Readiness probe             │
  │    /debug/pprof/   - Go profiling                │
  │    /swagger/       - OpenAPI docs                │
  └─────────────────────────────────────────────────┘
```

### HTTP → gRPC Translation

HTTP requests arriving at port 9091 are automatically translated to gRPC calls by grpc-gateway. The translation rules are defined in your `.proto` file via `google.api.http` annotations:

```protobuf
rpc Echo(EchoRequest) returns (EchoResponse) {
    option (google.api.http) = {
        post: "/api/v1/example/echo"
        body: "*"
    };
}
```

This means `POST /api/v1/example/echo` on port 9091 is translated to a gRPC call to `Echo()` on port 9090. The response is converted back to JSON automatically.

## Server Interceptor Chain

Interceptors are gRPC middleware that run on every request. ColdBrew chains them in this order:

| Order | Interceptor | Package | What It Does |
|-------|------------|---------|--------------|
| 1 | Response Time Logging | `interceptors` | Logs method name, duration, and status code |
| 2 | Trace ID | `interceptors` | Extracts or generates a trace ID and adds it to the context |
| 3 | Context Tags | `grpc_ctxtags` | Extracts gRPC metadata into context tags for logging |
| 4 | OpenTracing | `grpc_opentracing` | Creates a tracing span for the request |
| 5 | Prometheus | `grpc_prometheus` | Records request count, latency histogram, and status codes |
| 6 | Error Notification | `interceptors` | Sends errors to Sentry/Rollbar/Airbrake asynchronously |
| 7 | New Relic | `interceptors` | Creates a New Relic transaction for APM |
| 8 | Panic Recovery | `interceptors` | Catches panics and converts them to gRPC errors |

{: .note }
Health checks, ready checks, and gRPC reflection are **excluded by default** via `FilterMethods`. This prevents observability noise from Kubernetes probes. See the [FAQ](/faq) for how to customize this.

### Adding Custom Interceptors

You can prepend your own interceptors to the chain:

```go
func init() {
    interceptors.AddUnaryServerInterceptor(context.Background(), myCustomInterceptor)
}
```

{: .warning }
Interceptor configuration must happen during `init()`. These functions are not safe for concurrent use.

## Client Interceptor Chain

When your service calls other gRPC services, ColdBrew applies client-side interceptors:

| Interceptor | What It Does |
|------------|--------------|
| OpenTracing | Propagates trace context to downstream services |
| Hystrix | Circuit breaking (deprecated — consider failsafe-go) |
| Retry | Automatic retries with backoff |

## Context Propagation

ColdBrew uses `context.Context` to propagate metadata through every layer:

```
  context.Context
       │
       ├── options (key-value metadata)
       │     Set: options.Set(ctx, key, value)
       │     Get: options.Get(ctx, key)
       │
       ├── log fields (per-request structured logging)
       │     Add: log.AddToContext(ctx, key, value)
       │     Used by: interceptors, your handlers
       │
       ├── trace span (distributed tracing)
       │     Create: tracing.NewInternalSpan(ctx, "operation")
       │     Propagated by: OpenTracing interceptor
       │
       └── trace ID (request correlation)
             Injected by: Trace ID interceptor
             Available in: log output, error reports
```

Every interceptor reads from and writes to the context. By the time the request reaches your handler, the context carries:
- A unique trace ID for log correlation
- An active tracing span for distributed tracing
- Options set by upstream services
- Log fields added by interceptors

## Deployment Topology

A typical ColdBrew service exposes two ports:

```
  ┌─────────────────────────────────────────┐
  │           ColdBrew Service              │
  │                                         │
  │   Port 9090 (gRPC)                      │
  │   ├── Your gRPC service                 │
  │   ├── Health.Check (grpc health v1)     │
  │   └── ServerReflection                  │
  │                                         │
  │   Port 9091 (HTTP)                      │
  │   ├── /api/...     (REST gateway)       │
  │   ├── /healthcheck (liveness probe)     │
  │   ├── /readycheck  (readiness probe)    │
  │   ├── /metrics     (Prometheus)         │
  │   ├── /swagger/    (OpenAPI UI)         │
  │   └── /debug/pprof/ (profiling)         │
  └─────────────────────────────────────────┘
```

### Kubernetes Integration

ColdBrew is designed for Kubernetes deployments:

- **Liveness probe:** `GET /healthcheck` — returns build/version info as JSON (git commit, version, build date, Go version, OS/arch)
- **Readiness probe:** `GET /readycheck` — returns the same version JSON when ready for traffic, or an error if the service hasn't called `SetReady()` yet
- **gRPC health protocol:** Implements `grpc.health.v1.Health` ([standard gRPC health checking](https://github.com/grpc/grpc/blob/master/doc/health-checking.md)) on the gRPC port — used by gRPC load balancers, Envoy, Istio, and other service meshes for native health checking
- **Graceful shutdown:** On SIGTERM, the service marks itself as not ready, drains in-flight requests, then exits cleanly
- **Metrics scraping:** Prometheus scrapes `/metrics` on the HTTP port

### Startup Sequence

1. Configuration loaded from environment variables
2. Interceptor chain assembled (init-only, not thread-safe)
3. gRPC server starts on port 9090
4. HTTP gateway starts on port 9091
5. Service registers handlers (`InitGRPC`, `InitHTTP`)
6. Service marks itself as ready (`SetReady()`)
7. Server blocks until shutdown signal

### Shutdown Sequence

1. SIGTERM/SIGINT received
2. Service marked as not ready (`/readycheck` returns unhealthy)
3. Kubernetes stops routing new traffic
4. In-flight requests allowed to complete
5. `Stop()` called on the service (your cleanup logic)
6. Server exits
