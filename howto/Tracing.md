---
layout: default
title: "Tracing"
parent: "How To"
description: "Set up distributed tracing in ColdBrew with OpenTelemetry and New Relic for gRPC services"
---
## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

## Overview

ColdBrew provides a way to add tracing to your functions using the [go-coldbrew/tracing] package. The package implements tracing via [OpenTelemetry] (with support for any OTLP-compatible backend like Jaeger or Grafana Tempo) and [New Relic], enabling you to switch between them without changing your code.

{: .note .note-info }
Its possible for you to have multiple backends enabled at the same time, for example you can have both [New Relic] and [OpenTelemetry] enabled at the same time in the same span and they will both receive the same trace.

## Adding Tracing to your functions

ColdBrew provides a way to add tracing to your functions using the [go-coldbrew/tracing] package. The Package provides function like `NewInternalSpan/NewExternalSpan/NewDatabaseSpan` which will create a new span and add it to the context.

Make sure you use the context returned from the `NewInternalSpan/NewExternalSpan/NewDatabaseSpan` functions. This is because the span is added to the context. If you don't use the context returned from the function, new spans will not be add at the correct place in the trace.

You can also add tags to the span using the `SetTag/SetQuery/SetError` function. These tags will be added to the span and will be visible in the trace view of your tracing system (e.g. New Relic / OpenTelemetry).

```go
import (
    "github.com/go-coldbrew/tracing"
    "context"
)

func myFunction1(ctx context.Context) {
    span, ctx := tracing.NewInternalSpan(ctx, "myFunction1") // start a new span for this function
    defer span.End() // end the span when the function returns
    span.SetTag("myTag", "myValue") // add a tag to the span to help identify it in your tracing system
    // do something
    myFunction2(ctx)
    // do something
}

func myFunction2(ctx context.Context) {
    span, ctx := tracing.NewInternalSpan(ctx, "myFunction2") // start a new span for this function
    defer span.End() // end the span when the function returns
    // do something
    helloWorld(ctx)
    // do something
}

func helloWorld(ctx context.Context) {
    span, ctx := tracing.NewInternalSpan(ctx, "helloWorld") // start a new span for this function
    defer span.End() // end the span when the function returns
    log.Info(ctx, "Hello World")
}

func main() {
    ctx := context.Background()
    myFunction1(ctx)
}
```

{: .important}
Adding `defer span.End()` will make sure that the span will end when the function returns. If you don't end the span, it may never be sent to the tracing system and/or have the wrong duration.

## Adding Tracing to your gRPC services
When you create a new service with [ColdBrew cookiecutter] it will automatically add tracing (New Relic / OpenTelemetry) to your gRPC services. This is done by adding the [interceptors] to your gRPC server.

{: .note .note-info }
To disable coldbrew provided interceptors you can call the function [UseColdBrewServcerInterceptors].

### Adding tracing to your gRPC server

see [Adding interceptors to your gRPC server]

### Adding tracing to your gRPC client

see [Adding interceptors to your gRPC client]

## Database and External Service Tracing

### Database tracing

Use [NewDatastoreSpan] for database operations. This creates spans with appropriate metadata for database queries:

```go
func queryUsers(ctx context.Context) ([]User, error) {
    span, ctx := tracing.NewDatastoreSpan(ctx, "postgres", "SELECT", "users")
    defer span.End()

    span.SetQuery("SELECT * FROM users WHERE active = true")
    // ... execute query
}
```

### External service calls

For HTTP calls to external services, use [NewExternalSpan] or [NewHTTPExternalSpan]:

```go
func callExternalAPI(ctx context.Context) error {
    span, ctx := tracing.NewExternalSpan(ctx, "payment-service", "https://api.payment.com/charge")
    defer span.End()
    // ... make HTTP call
}

// With header propagation for distributed tracing
func callWithHeaders(ctx context.Context) error {
    req, _ := http.NewRequest("GET", "https://api.example.com/data", nil)
    span, ctx := tracing.NewHTTPExternalSpan(ctx, "example-api", "https://api.example.com/data", req.Header)
    defer span.End()
    // Headers are automatically populated for distributed tracing
    // ... make HTTP call with req
}
```

## Working with Context Values

When working with background goroutines or async operations, you may need to preserve context values (like trace IDs) without inheriting cancellation.

### Creating a new context with parent values

Use [NewContextWithParentValues] to clone context values without inheriting cancellation/deadline:

```go
func asyncOperation(parentCtx context.Context) {
    // Create new context with parent's values but independent lifecycle
    ctx := tracing.NewContextWithParentValues(parentCtx)

    go func() {
        // This goroutine won't be cancelled when parentCtx is cancelled
        // but will have access to trace IDs and other values
        processAsync(ctx)
    }()
}
```

### Merging context values

Use [MergeContextValues] to combine values from two contexts:

```go
// Cancel/Deadline come from mainCtx
// Values are looked up in both contexts (mainCtx first, then parentCtx)
ctx := tracing.MergeContextValues(parentCtx, mainCtx)
```

{: .warning}
The functions `CloneContextValues` and `MergeParentContext` are deprecated. Use [NewContextWithParentValues] and [MergeContextValues] instead.

## Trace ID Propagation

ColdBrew automatically generates a unique trace ID for every request and propagates it across your observability stack. There are two ways a trace ID can enter the system:

### 1. HTTP header (default: `x-trace-id`)

When a request arrives via the HTTP gateway, ColdBrew reads the `x-trace-id` header (configurable via `TRACE_HEADER_NAME`) and forwards it as gRPC metadata. The `ServerErrorInterceptor` then injects it into the context.

```bash
# Pass a trace ID from the client
curl -H "x-trace-id: req-abc-123" localhost:9091/api/v1/echo -d '{"msg":"hello"}'
```

If no header is provided, ColdBrew generates a random trace ID automatically.

### 2. Proto field (`trace_id`)

If your request proto message has a `trace_id` field, the [TraceId interceptor] reads it automatically:

```protobuf
message EchoRequest {
    string msg = 1;
    string trace_id = 2;  // ColdBrew reads this automatically
}
```

The generated `GetTraceId()` (or `GetTraceID()`) method is detected via interface assertion — no registration needed. If both the HTTP header and proto field are present, the proto field takes precedence since it runs later in the interceptor chain.

### Where the trace ID appears

Once extracted, the trace ID is propagated to:

| Destination | How | Example |
|-------------|-----|---------|
| **Structured logs** | Added as `"trace"` field via log context | `{"level":"info","msg":"handled request","trace":"req-abc-123"}` |
| **Sentry / Rollbar / Airbrake** | Attached to error notifications as a tag | Visible in the error report for correlation |
| **OpenTelemetry spans** | Set as `coldbrew.trace_id` attribute on the active span | Links ColdBrew correlation ID to distributed traces |
| **Request context** | Stored in ColdBrew options | Accessible via `notifier.GetTraceId(ctx)` in your handler code |

{: .note }
ColdBrew's trace ID is separate from OpenTelemetry's W3C trace context. OpenTelemetry spans have their own trace/span IDs managed by the tracing SDK. ColdBrew's trace ID is a lightweight application-level correlation ID for logs and error reports. When an OTEL span is active, the trace ID is also set as the `coldbrew.trace_id` span attribute, connecting both systems.

This means a single trace ID connects your logs and error reports — you can search for `req-abc-123` in your log aggregator and Sentry to find the complete request flow.

### Customizing the header name

```bash
export TRACE_HEADER_NAME=x-request-id  # Use a different header
```

## Distributed Trace Propagation (W3C)

In addition to ColdBrew's application-level trace ID, OpenTelemetry propagates **W3C trace context** (`traceparent`/`tracestate` headers) for distributed tracing across services. This is what links spans together in your tracing backend (Jaeger, Tempo, etc.).

### What's automatic

ColdBrew handles these flows without any code:

| Flow | Propagation | How |
|------|------------|-----|
| **Incoming gRPC** | Extracted from gRPC metadata | OTEL gRPC stats handler |
| **Incoming HTTP** | Extracted from `traceparent` header | HTTP gateway tracing middleware |
| **HTTP → gRPC gateway** | Parent span linked to child | Context propagation via W3C propagator |
| **gRPC server → client** | Injected into outgoing metadata | OTEL gRPC stats handler |

### Outgoing HTTP calls

When calling external HTTP services, use `NewHTTPExternalSpan` to create a span and inject trace headers. Pass an `http.Header` to have headers injected automatically:

```go
hdr := make(http.Header)
span, ctx := tracing.NewHTTPExternalSpan(ctx, "payment-service", "https://payment-service/api/charge", hdr)
defer span.End()

req, err := http.NewRequestWithContext(ctx, "POST", "https://payment-service/api/charge", body)
if err != nil {
    return err
}
req.Header = hdr

resp, err := http.DefaultClient.Do(req)
if err != nil {
    span.SetError(err)
    return err
}
defer resp.Body.Close()
```

{: .important }
If you make HTTP calls without `NewHTTPExternalSpan`, trace context is **not** propagated automatically. You must inject it manually:

```go
req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
if err != nil {
    return err
}
otel.GetTextMapPropagator().Inject(ctx, propagation.HeaderCarrier(req.Header))
resp, err := client.Do(req)
```

### Verifying propagation

To confirm trace context is flowing correctly, check your tracing backend for:
- A single OpenTelemetry trace (same W3C trace ID) connecting HTTP → gRPC → downstream spans
- Parent-child relationships between service boundaries
- The `traceparent` header in outgoing requests

---

[TraceId interceptor]: https://pkg.go.dev/github.com/go-coldbrew/interceptors#TraceIdInterceptor
[go-coldbrew/tracing]: https://pkg.go.dev/github.com/go-coldbrew/tracing
[ColdBrew cookiecutter]: /getting-started
[interceptors]: https://pkg.go.dev/github.com/go-coldbrew/interceptors
[UseColdBrewServcerInterceptors]: https://pkg.go.dev/github.com/go-coldbrew/interceptors#UseColdBrewServerInterceptors
[Default Client Interceptors]: https://pkg.go.dev/github.com/go-coldbrew/interceptors#DefaultClientInterceptors
[Default Interceptors]: https://pkg.go.dev/github.com/go-coldbrew/interceptors#DefaultInterceptors
[Adding interceptors to your gRPC server]: /howto/interceptors#adding-interceptors-to-your-grpc-server
[Adding interceptors to your gRPC client]: /howto/interceptors#adding-interceptors-to-your-grpc-client
[New Relic]: https://newrelic.com/
[OpenTelemetry]: https://opentelemetry.io/
[Jaeger]: https://www.jaegertracing.io/
[NewDatastoreSpan]: https://pkg.go.dev/github.com/go-coldbrew/tracing#NewDatastoreSpan
[NewExternalSpan]: https://pkg.go.dev/github.com/go-coldbrew/tracing#NewExternalSpan
[NewHTTPExternalSpan]: https://pkg.go.dev/github.com/go-coldbrew/tracing#NewHTTPExternalSpan
[NewContextWithParentValues]: https://pkg.go.dev/github.com/go-coldbrew/tracing#NewContextWithParentValues
[MergeContextValues]: https://pkg.go.dev/github.com/go-coldbrew/tracing#MergeContextValues
