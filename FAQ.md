---
layout: default
title: "FAQ"
nav_order: 7
description: "Frequently asked questions about ColdBrew"
permalink: /faq
---
# Frequently Asked Questions
{: .no_toc }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Can I use individual packages without core?

Yes. Every ColdBrew package is an independent Go module. You can use `errors`, `log`, `tracing`, `options`, `grpcpool`, or `data-builder` on their own without importing `core`. For example:

```go
import "github.com/go-coldbrew/errors"

err := errors.Wrap(originalErr, "failed to process request")
```

The dependency chain (`options → errors → log → ...`) only means that `log` imports `errors` internally — it does not mean you need to import the full chain.

## What Go version is required?

**Go 1.25 or later.** Older versions are end-of-life and not supported. All ColdBrew packages are tested against the latest stable Go release.

## Why are configuration functions not thread-safe?

Functions like `interceptors.AddUnaryServerInterceptor()`, `interceptors.SetFilterFunc()`, and `log.SetLogger()` follow the **init-only pattern**: they must be called during application startup (in `init()` or early in `main()`), before any concurrent access begins.

This is intentional and consistent across the entire codebase. The interceptor chain is assembled once at startup and then read concurrently — adding mutexes would add overhead to every single request for a code path that only runs once.

```go
func init() {
    // Safe: called during initialization, before server starts
    interceptors.AddUnaryServerInterceptor(ctx, myInterceptor)
    interceptors.SetFilterFunc(myFilter)
}
```

## Why are health checks excluded from tracing and logging?

By default, ColdBrew's `FilterMethods` excludes these methods from interceptor processing:

- `/grpc.health.v1.Health/Check`
- `/grpc.health.v1.Health/Watch`
- `/grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo`

Health checks run every few seconds (Kubernetes liveness/readiness probes). Logging and tracing each one would flood your observability systems with noise. If you need to include them, override the filter:

```go
func init() {
    interceptors.SetFilterFunc(func(fullMethodName string) bool {
        return false // don't filter anything
    })
}
```

## How do I migrate from OpenTracing to OpenTelemetry?

The `tracing` package supports both. To switch:

1. Update your tracing initialization to use OpenTelemetry's SDK
2. The `tracing.NewInternalSpan()`, `tracing.NewDatastoreSpan()`, and `tracing.NewExternalSpan()` functions work with both backends
3. See the [Tracing How-To](/howto/tracing) and [Integrations](/integrations) guides for setup details

## Is hystrixprometheus still maintained?

**No.** The `hystrixprometheus` package depends on `afex/hystrix-go`, which is unmaintained. Do not invest in this package for new projects.

For circuit breaking, consider [failsafe-go](https://github.com/failsafe-go/failsafe-go) as an alternative. The client-side interceptors in the `interceptors` package provide retry and circuit breaking functionality that covers most use cases.

## How do I do cross-package development?

When making changes that span multiple ColdBrew packages:

1. **Work in dependency order:** `options` first, `core` last
2. **Use `replace` directives** in `go.mod` to point to local checkouts during development:
   ```
   replace github.com/go-coldbrew/errors => ../errors
   ```
3. **Remove all `replace` directives before committing**
4. **Publish in order:** After merging upstream packages, bump versions in downstream `go.mod` files following the dependency chain

## How do I add custom Prometheus metrics?

ColdBrew exposes Prometheus metrics at `/metrics` automatically. To add your own:

```go
import "github.com/prometheus/client_golang/prometheus"

var requestsTotal = prometheus.NewCounterVec(
    prometheus.CounterOpts{
        Name: "myservice_requests_total",
        Help: "Total number of requests by method",
    },
    []string{"method"},
)

func init() {
    prometheus.MustRegister(requestsTotal)
}
```

See the [Metrics How-To](/howto/metrics) for more details.

## How do I configure graceful shutdown?

ColdBrew handles SIGTERM and SIGINT automatically. When a signal is received:

1. The service is marked as not ready (`/readycheck` returns unhealthy)
2. Kubernetes stops routing new traffic
3. In-flight requests are allowed to complete
4. The server shuts down cleanly

You can register cleanup callbacks and customize shutdown behavior. See the [Signals How-To](/howto/signals) for details.

## How do I report errors to Sentry?

Set the `SENTRY_DSN` environment variable and use the errors package:

```go
import "github.com/go-coldbrew/errors"

// This notifies Sentry asynchronously (bounded, won't leak goroutines)
errors.NotifyAsync(err, severity, args...)
```

See the [Errors How-To](/howto/errors) and [Integrations](/integrations) for full setup instructions.

## Where can I get help?

- **[GitHub Discussions](https://github.com/go-coldbrew/core/discussions)** — Ask questions, share ideas
- **[GitHub Issues](https://github.com/go-coldbrew/core/issues)** — Report bugs
- **[How-To Guides](/howto)** — Step-by-step guides for common tasks
- **[Integrations](/integrations)** — Third-party service setup
