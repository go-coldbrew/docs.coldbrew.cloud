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
