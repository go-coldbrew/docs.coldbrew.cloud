---
layout: default
title: Home
nav_order: 1
description: "ColdBrew is a Go microservice framework for building production-grade gRPC services with built-in observability."
permalink: /
---
# ColdBrew
{: .fs-9 }

A Kubernetes-native Go microservice framework for building production-grade gRPC services with built-in observability, resilience, and HTTP gateway support. Follows [12-factor](https://12factor.net/) principles out of the box.
{: .fs-6 .fw-300 }

**Production-proven:** Powers 100+ microservices, handling peaks of ~70k QPS per service at [Gojek](https://www.gojek.com/en-id/).
{: .fs-5 .fw-500 }

[Get Started](/getting-started){: .btn .btn-primary .fs-5 .mb-4 .mb-md-0 .mr-2 }
[View Packages](/packages){: .btn .fs-5 .mb-4 .mb-md-0 .btn-blue .mr-2}
[How To](/howto){: .btn .fs-5 .mb-4 .mb-md-0 .mr-2 .btn-green}
[GitHub](https://github.com/go-coldbrew/){: .btn .fs-5 .mb-4 .mb-md-0 .mr-2}

---

## What You Get Out of the Box

| Feature | Description |
|---------|-------------|
| **gRPC + REST Gateway** | Define your API once in protobuf — get gRPC, REST, and [Swagger docs](/architecture#self-documenting-apis) automatically via [grpc-gateway]. HTTP gateway supports JSON, `application/proto`, and `application/protobuf` [content types](/howto/APIs/#http-content-type) out of the box |
| **Structured Logging** | Native [slog] with custom Handler — per-request context fields, trace ID propagation, and typed attrs for zero-boxing performance |
| **Distributed Tracing** | [OpenTelemetry] and [New Relic] support with automatic span creation via gRPC stats handlers — traces can be sent to any OTLP-compatible backend including [Jaeger] |
| **Prometheus Metrics** | Built-in request latency, error rate, and gRPC status code metrics at `/metrics` |
| **Error Tracking** | Stack traces, gRPC status codes, and async notification to [Sentry], Rollbar, or Airbrake |
| **Rate Limiting** | Per-pod token bucket rate limiter — disabled by default, pluggable via custom [`ratelimit.Limiter`](https://pkg.go.dev/github.com/grpc-ecosystem/go-grpc-middleware/v2/interceptors/ratelimit#Limiter) interface for distributed or per-tenant rate limiting. Config: `RATE_LIMIT_PER_SECOND`. See [interceptors howto](/howto/interceptors#rate-limiting) |
| **Auth Examples** | JWT and API key authentication interceptor examples in the [cookiecutter template][ColdBrew cookiecutter], built on [go-grpc-middleware auth](https://github.com/grpc-ecosystem/go-grpc-middleware/tree/main/interceptors/auth). See [auth howto](/howto/auth/) |
| **Fast Serialization** | [vtprotobuf] codec enabled by default — faster gRPC marshalling with automatic fallback to standard protobuf |
| **TLS with Auto-Reload** | Automatic certificate hot-reloading via [certinel](https://github.com/cloudflare/certinel) — updated certs are picked up without a restart; works with cert-manager and Vault symlink rotation |
| **Kubernetes-native** | Health/ready probes, graceful SIGTERM shutdown, structured JSON logs, Prometheus metrics — all wired automatically |
| **Service Lifecycle Hooks** | Optional `PreStart`/`PostStart`/`PreStop`/`Stop`/`PostStop` callbacks for setup, registration, draining, and cleanup — see [service lifecycle interfaces](/howto/signals#service-lifecycle-interfaces) |
| **Swagger / OpenAPI** | Interactive API docs auto-served at `/swagger/` from your protobuf definitions |
| **Profiling** | Go [pprof] endpoints at `/debug/pprof/` for CPU, memory, goroutine, and trace profiling |
| **gRPC Reflection** | Server reflection enabled by default — works with [grpcurl], [grpcui], and Postman |
| **HTTP Compression** | Automatic gzip and [zstd] compression for all HTTP gateway responses (content-negotiated via `Accept-Encoding`) |
| **Container-aware Runtime** | Auto-tunes GOMAXPROCS to match container CPU limits via [automaxprocs] |
| **Request Validation** | [Protovalidate] annotations enforced automatically on both gRPC and HTTP requests — define validation rules in your proto, get `InvalidArgument` errors for free |
| **CI/CD Pipelines** | Ready-to-use [GitHub Actions] and [GitLab CI] workflows for build, test, lint, coverage, and benchmarks |
| **Local Dev Stack** | Docker Compose with 21 services across 18 single-service profiles plus the `obs` group profile (databases, caches, brokers, AWS/GCP emulators) — `make local-stack` starts your selection, `make local-stack-obs` adds [Prometheus], [Grafana], [Jaeger] |
| **Application Metrics** | Interface-based metrics package with [promauto] registration — counter and histogram examples wired into handlers |
| **Load Testing** | [ghz] gRPC load test config with `make loadtest` — results visible in Grafana dashboard when running with `make local-stack-obs` |

## Quick Start

Generate a new service in seconds:

```bash
# Install cookiecutter
brew install cookiecutter  # or: pip install cookiecutter

# Generate a new service
cookiecutter gh:go-coldbrew/cookiecutter-coldbrew

# Build and run
cd MyService/
make run
```

Your service starts with all of these endpoints ready:

| Endpoint | Description |
|----------|-------------|
| `localhost:9090` | gRPC server |
| `localhost:9091` | HTTP/REST gateway (auto-mapped from gRPC) |
| `localhost:9091/metrics` | Prometheus metrics |
| `localhost:9091/healthcheck` | Liveness probe — returns build/version info as JSON |
| `localhost:9091/readycheck` | Readiness probe — returns version JSON when ready |
| `localhost:9091/swagger/` | Swagger UI |
| `localhost:9091/debug/pprof/` | Go pprof profiling |

> **Tip:** Set `ADMIN_PORT` to serve metrics, profiling, and swagger on a dedicated port for [security isolation](/howto/production/#security-hardening).

## Define Once, Get Everything

Your API is defined once in protobuf — ColdBrew generates everything else:

```protobuf
rpc Echo(EchoRequest) returns (EchoResponse) {
    option (google.api.http) = {
        post: "/api/v1/echo"
        body: "*"
    };
}
```

This single definition gives you:
- **gRPC endpoint** on `:9090` — with reflection for [grpcurl] and Postman
- **REST endpoint** at `POST /api/v1/echo` on `:9091` — via [grpc-gateway]
- **Swagger UI** at `/swagger/` — interactive API docs from your proto
- **Prometheus metrics** — per-method latency, error rate, and request count
- **Distributed tracing** — automatic span creation through the interceptor chain

Run `buf generate` — it creates typed Go interfaces from your proto definitions. The compiler ensures every RPC method is implemented, so API changes are caught at build time, not runtime. Just fill in your business logic and `make run`. Logging, tracing, metrics, health checks, and graceful shutdown are wired automatically. See the [full pipeline](/architecture#self-documenting-apis) for details.

## How It Works

```
                    ┌─────────────────────────────────────────┐
                    │              ColdBrew Core               │
   HTTP Request ──► │  ┌─────────┐    ┌────────────────────┐  │
                    │  │  HTTP    │    │  Interceptor Chain  │  │
                    │  │ Gateway  │──► │                     │  │
                    │  │ (grpc-  │    │  ► Response Time    │  │
   gRPC Request ──► │  │ gateway)│    │  ► Trace ID         │  │
                    │  └─────────┘    │  ► Proto Validate   │  │
                    │       │         │  ► Prometheus        │  │
                    │       ▼         │  ► Error Notify      │  │
                    │  ┌─────────┐    │  ► Panic Recovery    │  │
                    │  │  gRPC   │──► │                     │  │──► Your Handler
                    │  │ Server  │    │                     │  │
                    │  └─────────┘    └────────────────────┘  │
                    │                                         │
                    │  /metrics  /healthcheck  /debug/pprof   │
                    └─────────────────────────────────────────┘
```

See the [full interceptor chain](/architecture#server-interceptor-chain) for all 10 interceptors including timeout, rate limiting, debug logging, and New Relic.

## Packages

ColdBrew is modular — use the full framework or pick individual packages:

| Package | What It Does |
|---------|-------------|
| [**core**](https://github.com/go-coldbrew/core) | gRPC server + HTTP gateway, health checks, graceful shutdown |
| [**interceptors**](https://github.com/go-coldbrew/interceptors) | Server/client interceptors for logging, tracing, metrics, retries |
| [**errors**](https://github.com/go-coldbrew/errors) | Enhanced errors with stack traces and gRPC status codes |
| [**log**](https://github.com/go-coldbrew/log) | slog-native structured logging with context field injection |
| [**tracing**](https://github.com/go-coldbrew/tracing) | Distributed tracing (OpenTelemetry, Jaeger, New Relic) |
| [**options**](https://github.com/go-coldbrew/options) | Request-scoped key-value store via context |
| [**grpcpool**](https://github.com/go-coldbrew/grpcpool) | Round-robin gRPC connection pool |
| [**data-builder**](https://github.com/go-coldbrew/data-builder) | Dependency injection with parallel execution |
| [**workers**](https://github.com/go-coldbrew/workers) | Background worker lifecycle with panic recovery and restart |

Each package can be used independently — you don't need `core` to use `errors` or `log`.

## Don't Repeat Yourself — Focus on Business Logic

Every Go microservice needs health probes, Prometheus metrics, structured logging, distributed tracing, graceful shutdown, and panic recovery. Without a framework, teams copy-paste this infrastructure into every service — and each copy drifts slightly, making debugging and onboarding harder.

ColdBrew handles all of it. You write business logic, ColdBrew handles everything else:

| You write | ColdBrew handles |
|-----------|-----------------|
| Proto definitions + business logic | gRPC server + REST gateway via [grpc-gateway] |
| `OTLP_ENDPOINT` env var | Distributed tracing with automatic span creation via [OpenTelemetry] |
| `NEW_RELIC_LICENSE_KEY` env var | APM integration via [New Relic] |
| Error returns | Stack traces, gRPC status codes, async notification to [Sentry]/Rollbar/Airbrake |
| Nothing | Prometheus metrics at `/metrics` — per-method latency, error rate, QPS |
| Nothing | Health/ready probes, graceful shutdown, [pprof] profiling |
| Nothing | Interceptor chain: logging, tracing, metrics, panic recovery |
| Proto validation annotations | Request validation via [Protovalidate] — `InvalidArgument` on failure, covers gRPC and HTTP |
| Nothing | [vtprotobuf] codec — up to ~4x faster proto marshal |
| Nothing | HTTP content negotiation — JSON, `application/proto`, `application/protobuf` out of the box |
| Nothing | HTTP [gzip/zstd][zstd] compression, container-aware [GOMAXPROCS][automaxprocs] |

New services inherit all of this automatically via the [cookiecutter template](/getting-started) — zero boilerplate to write, zero infrastructure to maintain.

### Built on battle-tested libraries

ColdBrew composes proven Go libraries — not replacements:

| Category | Libraries |
|----------|----------|
| **API** | [grpc] + [grpc-gateway] — gRPC server with automatic REST gateway and Swagger UI; [Protovalidate] — request validation |
| **Observability** | [OpenTelemetry] + [Jaeger] — distributed tracing; [Prometheus] + [go-grpc-middleware] — metrics |
| **Monitoring** | [New Relic] — APM; [Sentry] — error tracking and alerting |
| **Performance** | [vtprotobuf] — fast serialization; [klauspost/compress][zstd] — gzip/zstd HTTP compression |
| **Runtime** | [automaxprocs] — container-aware GOMAXPROCS; [slog] — structured logging |

## Next Steps

- **[Getting Started](/getting-started)** — Create your first ColdBrew service
- **[How-To Guides](/howto)** — Step-by-step guides for common tasks
- **[Production Deployment](/howto/production)** — Kubernetes, health probes, tracing, and graceful shutdown
- **[Integrations](/integrations)** — Set up monitoring, tracing, and error tracking
- **[FAQ](/faq)** — Common questions and answers

---
[grpc]:https://grpc.io/
[grpc-gateway]:https://grpc-ecosystem.github.io/grpc-gateway/
[prometheus]:https://prometheus.io/
[jaeger]:https://www.jaegertracing.io/
[opentelemetry]: https://opentelemetry.io/
[new relic]: https://newrelic.com/
[sentry]: https://sentry.io/
[go-grpc-middleware]: https://pkg.go.dev/github.com/grpc-ecosystem/go-grpc-middleware/v2
[vtprotobuf]: https://github.com/planetscale/vtprotobuf
[pprof]: https://pkg.go.dev/net/http/pprof
[grpcurl]: https://github.com/fullstorydev/grpcurl
[grpcui]: https://github.com/fullstorydev/grpcui
[automaxprocs]: https://github.com/uber-go/automaxprocs
[GitHub Actions]: https://github.com/features/actions
[GitLab CI]: https://docs.gitlab.com/ci/
[slog]: https://pkg.go.dev/log/slog
[zstd]: https://datatracker.ietf.org/doc/html/rfc8878
[Protovalidate]: https://github.com/bufbuild/protovalidate
[Grafana]: https://grafana.com/
[promauto]: https://pkg.go.dev/github.com/prometheus/client_golang/prometheus/promauto
[ghz]: https://ghz.sh/
[ColdBrew cookiecutter]: /getting-started
