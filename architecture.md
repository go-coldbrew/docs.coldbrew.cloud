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

## Self-Documenting APIs

ColdBrew follows a **define once, get everything** approach. Your `.proto` file is the single source of truth — one `buf generate` produces everything your service needs:

```
                          ┌─── Go protobuf types         (*.pb.go)
                          ├─── gRPC service stubs         (*_grpc.pb.go)
  myservice.proto ──buf──►├─── HTTP/REST gateway handlers (*.gw.go)
                          ├─── OpenAPI/Swagger spec       (*.swagger.json)
                          └─── vtprotobuf fast codec      (*_vtproto.pb.go)
```

Each output maps to a self-documenting endpoint:

| Output | Serves | How Clients Discover It |
|--------|--------|------------------------|
| gRPC stubs | `:9090` | gRPC reflection — `grpcurl -plaintext localhost:9090 list` |
| HTTP gateway | `:9091/api/...` | Swagger UI at `/swagger/` |
| OpenAPI spec | `:9091/swagger/*.swagger.json` | Import into Postman, code generators, or API gateways |
| Health/version | `:9091/healthcheck` | Returns git commit, version, build date, Go version as JSON |
| Metrics | `:9091/metrics` | Prometheus self-describing exposition format with HELP lines |
| Profiling | `:9091/debug/pprof/` | Standard Go pprof index page |

**Every client gets documentation for free:**
- **gRPC clients** use server reflection to discover services and methods without proto files
- **REST clients** use the interactive Swagger UI or import the OpenAPI spec
- **Operations** use health checks (build metadata), Prometheus metrics, and pprof

The HTTP annotations in your proto file define both the REST routes and their Swagger documentation simultaneously:

```protobuf
rpc Echo(EchoRequest) returns (EchoResponse) {
    option (google.api.http) = {
        post: "/api/v1/example/echo"
        body: "*"
    };
    option (grpc.gateway.protoc_gen_openapiv2.options.openapiv2_operation) = {
        summary: "Echo endpoint"
        description: "Returns the input message unchanged."
        tags: "example"
    };
}
```

This creates: a gRPC method, a `POST /api/v1/example/echo` REST endpoint, and a documented Swagger UI entry — all from one definition.

### Type-Safe by Design

`buf generate` produces typed Go interfaces from your proto service definitions. When you add a new RPC method to your `.proto` file and regenerate, the Go compiler will refuse to build until you implement it — there's no way to forget an endpoint or deploy a half-implemented API.

```
myservice.proto          buf generate         Go compiler
─────────────── ──────────────────────► ─────────────────
rpc Echo(...)           EchoServer interface   ✓ Implemented
rpc Greet(...)          GreetServer interface  ✗ Build error until implemented
```

This means your proto file is the **contract** — the compiler enforces it, grpc-gateway serves it as REST, and the OpenAPI spec documents it. They can never drift from each other.

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
  │  │  3. Prometheus Metrics                    │   │
  │  │  4. Error Notification (Sentry/Rollbar)   │   │
  │  │  5. New Relic Transaction                 │   │
  │  │  6. Panic Recovery                        │   │
  │  │  (OTEL tracing via gRPC stats handler)    │   │
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
| 2 | Trace ID | `interceptors` | Generates a trace ID (or reads it from the `x-trace-id` HTTP header or a `trace_id` proto field) and propagates it to structured logs, Sentry/Rollbar error reports, and OpenTelemetry spans (as the `coldbrew.trace_id` attribute) |
| 3 | Proto Validate | `interceptors` | Validates incoming messages using [protovalidate](https://github.com/bufbuild/protovalidate) annotations. Returns `InvalidArgument` on failure. Disable with `DISABLE_PROTO_VALIDATE` |
| 4 | Prometheus | `interceptors` | Records request count, latency histogram, and status codes |
| 5 | Error Notification | `interceptors` | Sends errors to Sentry/Rollbar/Airbrake asynchronously |
| 6 | New Relic | `interceptors` | Creates a New Relic transaction for APM |
| 7 | Panic Recovery | `interceptors` | Catches panics and converts them to gRPC errors |

{: .note }
OpenTelemetry tracing spans are created by the `otelgrpc` stats handler configured at the gRPC server/client level, not as an interceptor in the chain.

{: .note }
Health checks, ready checks, and gRPC reflection are **excluded by default** via `FilterMethods`. This prevents observability noise from Kubernetes probes. See the [FAQ](/faq) for how to customize this.

### Interceptor Chain Overhead

The full interceptor chain adds **~10–12% overhead** compared to bare gRPC (no interceptors). Most of that overhead comes from per-request log writes (I/O), not the interceptor framework itself. Setting `RESPONSE_TIME_LOG_ERROR_ONLY=true` closes most of the gap (see Tuned row below).

End-to-end throughput measured on Apple M1 Pro (loopback, [ghz](https://ghz.sh/) load test, simple Echo handler):

| Configuration | RPS @ c=1 | RPS @ c=50 | RPS @ c=200 | Avg @ c=1 | P99 @ c=200 |
|---------------|-----------|------------|-------------|-----------| ------------|
| **Default** (all interceptors) | 5,500 | 40,900 | 50,000 | 0.12ms | 7.9ms |
| **Tuned** (error-only logging, no histograms) | 6,300 | 42,700 | 53,200 | 0.10ms | 7.3ms |
| **No interceptors** (bare gRPC) | 7,000 | 46,600 | 55,800 | 0.09ms | 7.2ms |

Per-interceptor micro-benchmark: **~4.1µs, ~1.5KB, ~37 allocs** per unary request. Profile with:
```bash
go test -run='^$' -bench=BenchmarkDefaultInterceptors -benchmem ./...
```

The tuned configuration uses `RESPONSE_TIME_LOG_ERROR_ONLY=true` and `ENABLE_PROMETHEUS_GRPC_HISTOGRAM=false`. See the [Configuration Reference](/config-reference#example-high-throughput-production) for the full set of tuning knobs.

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
| Hystrix | Circuit breaking (deprecated — consider failsafe-go) |
| Retry | Automatic retries with backoff |

{: .note }
Trace context propagation to downstream services is handled by the `otelgrpc` client stats handler, not a chain interceptor.

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
       │     Propagated by: OTEL gRPC stats handler
       │
       └── trace ID (request correlation)
             Injected by: Trace ID interceptor
             Available in: log output, error reports, OpenTelemetry spans (`coldbrew.trace_id` attribute)
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

### Gateway Performance Options

By default, the HTTP gateway connects to the gRPC server via TCP loopback (`localhost:9090`). Two options are available for lower latency:

**Option 1: Unix domain socket (opt-in, zero code changes)**

Set `DISABLE_UNIX_GATEWAY=false` to route the gateway's internal connection through a Unix socket. This reduces gateway-to-gRPC latency from ~67µs to ~36µs (**1.9x improvement**) by bypassing TCP overhead. The TCP gRPC port remains available for external clients. If socket creation fails, the gateway silently falls back to TCP.

When gRPC TLS is configured (`GRPC_TLS_CERT_FILE` + `GRPC_TLS_KEY_FILE`), the unix socket is automatically skipped — `grpc.Server` applies TLS to all listeners, and the gateway falls back to TCP with proper TLS credentials.

**Option 2: In-process gateway via `DoHTTPtoGRPC` (maximum performance)**

For zero network hop, use `RegisterHandlerServer` instead of `RegisterHandlerFromEndpoint` in your `InitHTTP`, and wrap each gRPC method with [`interceptors.DoHTTPtoGRPC()`](https://pkg.go.dev/github.com/go-coldbrew/interceptors#DoHTTPtoGRPC). This calls the gRPC handler in-process while preserving the full interceptor chain (logging, tracing, metrics, panic recovery). Requires a per-method wrapper but eliminates all network overhead.

```go
func (s *svc) Echo(ctx context.Context, req *proto.EchoRequest) (*proto.EchoResponse, error) {
    handler := func(ctx context.Context, req interface{}) (interface{}, error) {
        return s.echo(ctx, req.(*proto.EchoRequest))
    }
    r, err := interceptors.DoHTTPtoGRPC(ctx, s, handler, req)
    if err != nil {
        return nil, err
    }
    return r.(*proto.EchoResponse), nil
}
```

| Approach | Latency | Code changes | Trade-offs |
|----------|---------|-------------|------------|
| TCP loopback (default) | ~67µs | None | Simplest, most compatible |
| Unix socket | ~36µs | None (config only) | 1.9x faster, opt-in |
| `DoHTTPtoGRPC` | ~19µs | Per-method wrapper | Fastest, requires code changes |

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
