---
layout: default
title: Concepts
nav_order: 9
description: "Glossary of the gRPC, observability, and resilience concepts that ColdBrew builds on. Single-paragraph definitions with links to the deeper guides."
permalink: /concepts/
---
# Concepts

A reader who is comfortable with REST but new to the gRPC ecosystem will hit unfamiliar terms in the first few pages — `interceptor`, `gateway`, `vtprotobuf`, `OTLP`, `span`. This page collects them in one place so you can scan a definition and follow the link for depth.

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## gRPC

A high-performance RPC framework from Google that uses HTTP/2 as the transport and Protocol Buffers as the schema/wire format. Methods are typed (request and response messages are defined in `.proto` files) and code is generated for both client and server, so the network call looks like a local function call. ColdBrew is gRPC-first — every service starts as a gRPC server, and the HTTP/JSON surface is generated from the same proto definition. See [grpc.io](https://grpc.io/) for the upstream docs and [APIs how-to](/howto/APIs) for how ColdBrew wires it up.

## gRPC reflection

Server reflection is a gRPC feature that lets a client discover the available methods and message types at runtime, without needing the `.proto` files locally. Tools like [grpcurl], [grpcui], and Postman use reflection to call services interactively. ColdBrew enables it by default; disable it on public-facing services with `DISABLE_GRPC_REFLECTION=true` (see [Production Deployment](/howto/production)).

## grpc-gateway

[grpc-gateway] is a code generator that produces a reverse-proxy HTTP/1.1+JSON server in front of your gRPC service, mapping HTTP routes to gRPC methods using `google.api.http` annotations in the proto. ColdBrew runs the gateway in-process alongside the gRPC server so a single binary speaks both protocols. See [APIs how-to](/howto/APIs) for the routing annotations and [HTTP Gateway Extensions](/howto/gateway-extensions) for adding custom marshalers or middleware.

## Interceptors

Interceptors are gRPC's middleware. They wrap each unary or streaming RPC, running code before and after the handler — logging, tracing, metrics, validation, panic recovery, auth. ColdBrew ships a default chain (response-time logging → trace ID → OpenTelemetry → Prometheus → error notification → New Relic → panic recovery) and exposes hooks to insert your own. See [Interceptors how-to](/howto/interceptors) for the chain order and how to add custom interceptors, and [Authentication](/howto/auth) for an auth-interceptor example.

## vtprotobuf

[vtprotobuf] is a code generator that produces faster Marshal/Unmarshal methods for Protocol Buffer messages — typically 2–3× faster than the reflection-based standard implementation. ColdBrew uses vtprotobuf as its default gRPC codec with automatic fallback to standard protobuf when a message type doesn't have generated VT methods. See [vtprotobuf how-to](/howto/vtproto) for the generator setup.

## Protovalidate

[Protovalidate](https://buf.build/docs/protovalidate/overview) defines validation rules as proto annotations (`buf.validate.field`) and enforces them at runtime. ColdBrew applies validation automatically on both gRPC and HTTP requests, so a malformed payload is rejected with `InvalidArgument` before it reaches your handler. See [Interceptors how-to — Proto Validation](/howto/interceptors#proto-validation).

## OTLP

OpenTelemetry Protocol — the wire format used by [OpenTelemetry] to ship traces, metrics, and logs from your service to a collector or backend. Most modern observability stacks (Jaeger, Tempo, Honeycomb, Datadog, New Relic) accept OTLP, so configuring ColdBrew with `OTLP_ENDPOINT` keeps you portable. See [Tracing how-to](/howto/Tracing) and [Production Deployment — Distributed tracing](/howto/production#distributed-tracing).

## Trace ID

A unique identifier attached to a request that follows it across every service, log line, and span. ColdBrew generates one per request (or accepts one from the `TRACE_HEADER_NAME` HTTP header / proto `trace_id` field), propagates it through context, and adds it to every log line and span automatically. The trace ID is what makes "find every log for this user's failed checkout" tractable in a centralized log sink. See [Tracing how-to](/howto/Tracing) and [Debugging](/howto/Debugging).

## Span

A span represents one unit of work inside a trace — a function call, a database query, an outbound HTTP call. Spans nest inside each other, so a single trace becomes a tree showing where time was spent. ColdBrew exposes three helpers — `tracing.NewInternalSpan`, `tracing.NewDatastoreSpan`, `tracing.NewExternalSpan` — that create the right span type for the operation and put it in `context.Context`. See [Tracing how-to](/howto/Tracing).

## Circuit breaker

A circuit breaker watches the failure rate of an outbound call (a downstream gRPC service, a database, an external API) and "opens" — fast-fails subsequent calls — once failures exceed a threshold, giving the dependency time to recover instead of being hammered. ColdBrew exposes `interceptors.SetDefaultExecutor` so you can plug in any resilience library; [failsafe-go](https://github.com/failsafe-go/failsafe-go) is the recommended one. See [Circuit Breaker / Resilience](/integrations/#circuit-breaker--resilience) for setup and [gRPC how-to — Calling other services](/howto/gRPC#calling-other-services) for context.

## Healthcheck vs readycheck

Two HTTP endpoints with different jobs. `/healthcheck` (liveness) answers *is the process alive?* — if it fails, Kubernetes restarts the pod. `/readycheck` (readiness) answers *can it accept traffic right now?* — if it fails, Kubernetes stops routing traffic to the pod but does not restart it. During graceful shutdown, ColdBrew fails `/readycheck` first, waits the drain period, then exits — so in-flight requests finish without new ones being routed in. See [Production Deployment — Health probes](/howto/production#health-probes) and [Readiness Patterns](/howto/readiness).

## Lifecycle hooks

Optional interfaces a service can implement to run code at well-defined points in startup and shutdown: `CBPreStarter` (before servers listen), `CBPostStarter` (after they listen), `CBPreStopper` / `CBStopper` / `CBPostStopper` (during graceful shutdown), and `CBGracefulStopper.FailCheck` (toggle readiness). Use them to open and drain database pools, register/deregister with service discovery, flush buffers, and so on — without touching `core` itself. See [Shutdown Lifecycle](/howto/signals#service-lifecycle-interfaces) for the full table.

---

## Where to go next

- **[Quick Start](/getting-started)** — Generate a service from the cookiecutter and run it locally.
- **[How-To Guides](/howto)** — Task-oriented guides grouped by Build / Operate / Integrate / Advanced.
- **[Architecture](/architecture)** — How the pieces fit together end-to-end.

---
[grpc-gateway]: https://grpc-ecosystem.github.io/grpc-gateway/
[grpcurl]: https://github.com/fullstorydev/grpcurl
[grpcui]: https://github.com/fullstorydev/grpcui
[OpenTelemetry]: https://opentelemetry.io/
[vtprotobuf]: https://github.com/planetscale/vtprotobuf
