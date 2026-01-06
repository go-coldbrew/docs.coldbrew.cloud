---
layout: default
title: "Tracing"
parent: "How To"
---
## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

## Overview

Coldbrew provides a way to add tracing to your functions using the [go-coldbrew/tracing] package. The Package implements multiple tracing backends (e.g. [New Relic] / [Opentelemetry] / [Jaeger]) which enables you to switch between them without changing your code.

{: .note .note-info }
Its possible for you to have multiple backends enabled at the same time, for example you can have both [New Relic] and [Opentelemetry] enabled at the same time in the same span and they will both receive the same trace.

## Adding Tracing to your functions

ColdBrew provides a way to add tracing to your functions using the [go-coldbrew/tracing] package. The Package provides function like `NewInternalSpan/NewExternalSpan/NewDatabaseSpan` which will create a new span and add it to the context.

Make sure you use the context returned from the `NewInternalSpan/NewExternalSpan/NewDatabaseSpan` functions. This is because the span is added to the context. If you don't use the context returned from the function, new spans will not be add at the correct place in the trace.

You can also add tags to the span using the `SetTag/SetQuery/SetError` function. These tags will be added to the span and will be visible in the trace view of your tracing system (e.g. New Relic / Opentelemetry).

```go
import (
    "github.com/go-coldbrew/tracing"
    "context"
)

func myFunction1(ctx context.Context) {
    span, ctx := tracing.NewInternalSpan(ctx, "myFunction1") // start a new span for this function
    defer span.End() // end the span when the function returns
    span.SetTag("myTag", "myValue") // add a tag to the span to help identify it in the trace view of your tracing system (e.g. Jaeger)
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
When you create a new service with [ColdBrew cookiecutter] it will automatically add tracing (New Relic / Opentelemetry) to your gRPC services. This is done by adding the [interceptors] to your gRPC server.

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
[Opentelemetry]: https://opentelemetry.io/
[Jaeger]: https://www.jaegertracing.io/
[NewDatastoreSpan]: https://pkg.go.dev/github.com/go-coldbrew/tracing#NewDatastoreSpan
[NewExternalSpan]: https://pkg.go.dev/github.com/go-coldbrew/tracing#NewExternalSpan
[NewHTTPExternalSpan]: https://pkg.go.dev/github.com/go-coldbrew/tracing#NewHTTPExternalSpan
[NewContextWithParentValues]: https://pkg.go.dev/github.com/go-coldbrew/tracing#NewContextWithParentValues
[MergeContextValues]: https://pkg.go.dev/github.com/go-coldbrew/tracing#MergeContextValues
