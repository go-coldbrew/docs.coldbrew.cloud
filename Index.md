---
layout: default
title: Home
nav_order: 1
description: "ColdBrew is a Go microservice framework for building production-grade gRPC services with built-in observability."
permalink: /
---
# ColdBrew
{: .fs-9 }

A Go microservice framework for building production-grade gRPC services with built-in observability, resilience, and HTTP gateway support.
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
| **gRPC + REST Gateway** | Define your API once in protobuf, get both gRPC and REST endpoints automatically via [grpc-gateway] |
| **Structured Logging** | Pluggable backends (go-kit, zap, logrus) with per-request context fields and trace ID propagation |
| **Distributed Tracing** | [OpenTelemetry], [Jaeger], and [New Relic] support with automatic span creation in interceptors |
| **Prometheus Metrics** | Built-in request latency, error rate, and circuit breaker metrics at `/metrics` |
| **Error Tracking** | Stack traces, gRPC status codes, and async notification to [Sentry], Rollbar, or Airbrake |
| **Resilience** | Client-side circuit breaking and retries via interceptors |
| **Fast Serialization** | [vtprotobuf] codec enabled by default — faster gRPC marshalling with automatic fallback to standard protobuf |

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

## Minimal Service Example

A ColdBrew service implements the `CBService` interface:

```go
package main

import (
    "context"

    "github.com/go-coldbrew/core"
    "github.com/go-coldbrew/core/config"
    "github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
    "google.golang.org/grpc"

    pb "github.com/yourorg/myservice/proto" // your generated protobuf package
)

type myService struct{}

func (s *myService) InitGRPC(ctx context.Context, server *grpc.Server) error {
    pb.RegisterMyServiceServer(server, s)
    return nil
}

func (s *myService) InitHTTP(ctx context.Context, mux *runtime.ServeMux, endpoint string, opts []grpc.DialOption) error {
    return pb.RegisterMyServiceHandlerFromEndpoint(ctx, mux, endpoint, opts)
}

func main() {
    cfg := config.GetColdBrewConfig()
    cb := core.New(cfg)
    cb.SetService(&myService{})
    cb.Run()
}
```

All logging, tracing, metrics, health checks, and graceful shutdown are wired automatically.

## How It Works

```
                    ┌─────────────────────────────────────────┐
                    │              ColdBrew Core               │
   HTTP Request ──► │  ┌─────────┐    ┌────────────────────┐  │
                    │  │  HTTP    │    │  Interceptor Chain  │  │
                    │  │ Gateway  │──► │                     │  │
                    │  │ (grpc-  │    │  ► Response Time    │  │
   gRPC Request ──► │  │ gateway)│    │  ► Trace ID         │  │
                    │  └─────────┘    │  ► Context Tags     │  │
                    │       │         │  ► OpenTelemetry     │  │
                    │       ▼         │  ► Prometheus        │  │
                    │  ┌─────────┐    │  ► Error Notify      │  │
                    │  │  gRPC   │──► │  ► Panic Recovery    │  │──► Your Handler
                    │  │ Server  │    │                     │  │
                    │  └─────────┘    └────────────────────┘  │
                    │                                         │
                    │  /metrics  /healthcheck  /debug/pprof   │
                    └─────────────────────────────────────────┘
```

## Packages

ColdBrew is modular — use the full framework or pick individual packages:

```
options → errors → log → tracing → grpcpool → interceptors → data-builder → core
```

| Package | What It Does |
|---------|-------------|
| [**core**](https://github.com/go-coldbrew/core) | gRPC server + HTTP gateway, health checks, graceful shutdown |
| [**interceptors**](https://github.com/go-coldbrew/interceptors) | Server/client interceptors for logging, tracing, metrics, retries |
| [**errors**](https://github.com/go-coldbrew/errors) | Enhanced errors with stack traces and gRPC status codes |
| [**log**](https://github.com/go-coldbrew/log) | Structured logging with pluggable backends |
| [**tracing**](https://github.com/go-coldbrew/tracing) | Distributed tracing (OpenTelemetry, Jaeger, New Relic) |
| [**options**](https://github.com/go-coldbrew/options) | Request-scoped key-value store via context |
| [**grpcpool**](https://github.com/go-coldbrew/grpcpool) | Round-robin gRPC connection pool |
| [**data-builder**](https://github.com/go-coldbrew/data-builder) | Dependency injection with parallel execution |

Each package can be used independently — you don't need `core` to use `errors` or `log`.

## Don't Repeat Yourself

ColdBrew integrates with the tools you already use:

- [grpc] + [grpc-gateway] — gRPC server with automatic REST gateway
- [prometheus] — Metrics and monitoring
- [opentelemetry] + [jaeger] — Distributed tracing
- [new relic] — Application performance monitoring
- [sentry] — Error tracking and alerting
- [go-grpc-middleware] — Middleware utilities
- [vtprotobuf] — Fast protobuf serialization

## Next Steps

- **[Getting Started](/getting-started)** — Create your first ColdBrew service
- **[Using ColdBrew](/using)** — Configure and extend your service
- **[How-To Guides](/howto)** — Step-by-step guides for common tasks
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
[go-grpc-middleware]: https://pkg.go.dev/github.com/grpc-ecosystem/go-grpc-middleware
[vtprotobuf]: https://github.com/planetscale/vtprotobuf
