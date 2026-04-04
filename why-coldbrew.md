---
layout: default
title: "Why ColdBrew"
nav_order: 3
description: "How ColdBrew solves the hard problems of running gRPC services at scale — observability, error handling, and incremental migration"
permalink: /why-coldbrew
---
# Why ColdBrew
{: .fs-9 }

ColdBrew was built to solve problems that only show up when you're running dozens of services in production. When you have one or two services, you can wire up tracing, logging, and error handling by hand. When you have a hundred, you need it to be automatic and consistent.

---

## The same observability everywhere

When a request hits your service, ColdBrew's interceptor chain automatically adds response time logging, trace ID propagation, Prometheus metrics, error notification, and panic recovery. You don't configure any of it per-service — it's the default.

This matters because debugging a production issue across 10 services is hard enough without discovering that service #7 logs differently, service #3 doesn't have tracing, and service #12 doesn't report errors to Sentry.

ColdBrew also ensures that HTTP gateway requests get the same interceptor chain as direct gRPC calls. Whether a request came from a mobile client via REST or from another service via gRPC, the logs, traces, and error reports look identical.

## One protobuf file, everything generated

ColdBrew is protobuf-first. You write a `.proto` file, and everything else is generated from it — gRPC server stubs, HTTP REST handlers, OpenAPI/Swagger documentation, and vtprotobuf fast serialization. Your protobuf definition is the single source of truth.

This means your API documentation can never drift from your implementation. The Swagger UI at `/swagger/` is generated from the same proto file that generates your Go code. If you add a field, it shows up in docs automatically. If you remove an endpoint, it disappears from docs. There's no separate markdown file to keep in sync.

The [buf](https://buf.build) toolchain handles all the code generation in one command. The cookiecutter template comes pre-configured with `buf.gen.yaml` that generates everything — protobuf Go code, gRPC stubs, grpc-gateway HTTP handlers, OpenAPI spec, and vtprotobuf fast marshallers.

You can also register [custom HTTP routes](/howto/APIs/#custom-http-routes) alongside your proto-generated endpoints for things like webhooks, file uploads, or OAuth callbacks — all through the same gateway with the same observability.

## Errors that carry context

When something goes wrong in a gRPC service, you need several things at once: a stack trace (for debugging), a gRPC status code (for the client), and an alert to your error tracker (for the on-call engineer). Most approaches give you one of these; ColdBrew's error type carries all of them:

```go
err := errors.NewWithStatus("payment declined", codes.FailedPrecondition)
// This error has: stack trace + gRPC status + errors.Is/As support + notification control
```

The notification control is subtle but important at scale. When an error propagates through multiple layers of your code, you want it reported to Sentry exactly once — not once per layer. ColdBrew tracks this with an atomic flag on the error itself, so the first notifier that sees it marks it as reported.

Error notifications go to Sentry, Rollbar, and Airbrake simultaneously. This isn't about using all three — it's about not being blind when your primary vendor has an outage during your incident.

## Migrate tracing vendors by changing config, not code

ColdBrew has gone through three tracing migrations — Jaeger to OpenTracing to OpenTelemetry — without requiring services to change their tracing code. The `tracing` package provides a stable API (`NewInternalSpan`, `NewDatastoreSpan`, `NewExternalSpan`) that abstracts over whatever backend is configured.

```go
span, ctx := tracing.NewInternalSpan(ctx, "process-order")
defer span.End()
span.SetTag("order_id", orderID)
```

This code hasn't changed across three backend migrations. What changed was the framework configuration:
- **Jaeger era:** Set `JAEGER_AGENT_HOST` — traces went to Jaeger
- **OpenTracing era:** Swapped the tracer implementation — same span API
- **OpenTelemetry era:** Set `OTLP_ENDPOINT` — traces go to any OTEL-compatible backend

Today, ColdBrew writes to both OpenTelemetry and New Relic simultaneously. This lets teams verify OTEL traces are correct before turning off New Relic — no flag day, no code changes, just configuration.

ColdBrew also links its own correlation ID (`coldbrew.trace_id`) to OTEL spans, so you can search for a single ID across your logs, error reports, and distributed traces.

## Migrate protobuf versions without coordination

With 100+ services, you can't upgrade everything at once. Some services use the original protobuf library, some use the newer `google.golang.org/protobuf`, and some have adopted vtprotobuf for performance. ColdBrew's codec handles all three transparently:

```
vtprotobuf → proto v2 → proto v1
```

It checks each message at runtime and uses the fastest available marshaller. Services with vtprotobuf-generated code get the performance benefit. Services still on proto v1 keep working. You migrate at your own pace.

## Performance-conscious by default

The interceptor chain runs on every request, so its overhead matters. ColdBrew's current baseline is **~4.9µs and 44 allocations per gRPC unary request** — measured, profiled, and tracked in benchmarks.

Some design choices that keep this low:
- **Filter caching** distinguishes gRPC from HTTP requests using a zero-allocation context lookup (`grpc.Method(ctx)`). gRPC method names are stable and cached; HTTP paths are high-cardinality and computed fresh.
- **Lazy stack resolution** captures program counters at error creation but only resolves function names when someone actually reads the stack trace.
- **Bounded async notifications** use a semaphore to cap concurrent goroutines. Under error storms, notifications are dropped rather than queued — protecting the service from goroutine explosion.

## Up and running in minutes

ColdBrew's [cookiecutter template](https://github.com/go-coldbrew/cookiecutter-coldbrew) generates a complete, production-ready service with one command:

```bash
cookiecutter gh:go-coldbrew/cookiecutter-coldbrew
```

What you get out of the box:
- **Working gRPC + HTTP service** with an example Echo RPC and health checks
- **Proto code generation** via buf — gRPC stubs, HTTP gateway, Swagger, vtprotobuf
- **CI/CD pipelines** — GitHub Actions and GitLab CI with build, test, lint, coverage, benchmarks
- **Docker** — multi-stage Dockerfile, non-root user, `.dockerignore`
- **Swagger UI** — interactive API docs at `/swagger/`
- **Prometheus metrics** at `/metrics`, pprof at `/debug/pprof/`
- **Structured logging** with JSON output, trace ID propagation
- **Graceful shutdown** with configurable drain duration
- **Linting** — golangci-lint v2 + govulncheck pre-configured
- **Mock generation** — mockery configured for interface mocking
- **Version injection** — build-time git commit, branch, date via ldflags

No boilerplate to write, no middleware to wire, no observability to configure. Run `make run` and you have a service with the same instrumentation as every other ColdBrew service in your organization.

## Container-aware from the start

ColdBrew is designed to run in containers. It auto-tunes `GOMAXPROCS` to match your container's CPU limits via [automaxprocs](https://github.com/uber-go/automaxprocs), so you don't waste CPU scheduling goroutines across cores you don't have.

Health and readiness probes are built in — `/healthcheck` and `/readycheck` return gRPC health status and are wired to respond correctly during graceful shutdown. When a SIGTERM arrives, ColdBrew:

1. Marks the service as not-ready (readiness probe fails)
2. Waits for the configured drain duration (load balancers stop sending traffic)
3. Gracefully stops the gRPC server (finishes in-flight requests)
4. Shuts down the HTTP server
5. Runs cleanup hooks

This works with Kubernetes out of the box — no custom signal handling or shutdown logic needed.

## Environment-variable configuration

Every ColdBrew setting is an environment variable with a sensible default. No config files, no YAML, no config center dependency. This follows the [12-factor](https://12factor.net/config) principle and works naturally with Kubernetes ConfigMaps, Docker Compose env files, and CI/CD secret injection.

```bash
# These are all optional — defaults work for local dev
export LOG_LEVEL=info
export OTLP_ENDPOINT=otel-collector:4317
export NEW_RELIC_LICENSE_KEY=your-key
```

The full [configuration reference](/config-reference) documents every variable, its type, default, and purpose.

## What ColdBrew leaves out

ColdBrew doesn't include a database layer, message queue abstraction, service discovery, or configuration center. These are intentional omissions.

Each of these problems has purpose-built tools that do it better than a framework can. Kubernetes DNS handles service discovery. Environment variables and ConfigMaps handle configuration. Your team's choice of Postgres driver or Kafka client is yours to make — ColdBrew won't force a particular integration.

ColdBrew focuses on the **cross-cutting concerns** that every service needs identically: observability, error handling, serialization, and lifecycle management. These are the things that are hard to retrofit consistently across many services after the fact.

---

## When ColdBrew fits

ColdBrew works best when you:
- Run multiple gRPC services and want them all instrumented the same way
- Need an HTTP gateway alongside gRPC without duplicating middleware
- Want production defaults (health probes, graceful shutdown, Prometheus, structured logging) that work without configuration
- Are incrementally migrating protobuf versions or tracing vendors
- Care about per-request overhead at high QPS

---

[Get Started](/getting-started){: .btn .btn-primary .fs-5 .mb-4 .mb-md-0 .mr-2 }
[Architecture](/architecture){: .btn .fs-5 .mb-4 .mb-md-0 .btn-blue .mr-2}
[How To](/howto){: .btn .fs-5 .mb-4 .mb-md-0 .mr-2 .btn-green}
