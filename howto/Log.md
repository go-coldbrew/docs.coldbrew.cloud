---
layout: default
title: "Log"
parent: "How To"
---
## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

## Context aware logs

In any service there a set of common items that you want to log with every log message. These items are usually things like the request-id, trace, user-id, etc. It is useful to have these items in the log message so that you can filter on them in your log aggregation system. This is especially useful when you have multiple points of logs and you want to be able to trace a request through the system.

ColdBrew provides a way to add these items to the log message using the `loggers.AddToLogContext` function. This function takes a `context.Context` and `key, value`. AddToLogContext adds log fields to context. Any info added here will be added to all logs using this context.

```go
import (
    "github.com/go-coldbrew/log"
    "github.com/go-coldbrew/log/loggers"
)

func handler(w http.ResponseWriter, r *http.Request) {
    ctx = r.Context()
    ctx = loggers.AddToLogContext(ctx, "request-id", "1234")
    ctx = loggers.AddToLogContext(ctx, "trace", "5678")
    ctx = loggers.AddToLogContext(ctx, "user-id", "abcd")
    helloWorld(ctx)
}

func helloWorld(ctx context.Context) {
    log.Info(ctx, "Hello World")
}
```

Will output

```json
{"level":"info","msg":"Hello World","request-id":"1234","trace":"5678","user-id":"abcd","@timestamp":"2020-05-04T15:04:05.000Z"}
```

## Trace ID propagation in logs

When you have multiple services, it is useful to be able to trace a request through the system. This is especially useful when you have a request that spans multiple services and you want to be able to see the logs for each service in the context of the request. Having a propagating trace id is a good way to do this.

{: .note }
Since trace id is a string it can have any application specific meaning like session id / order id / etc. ColdBrew does not enforce any specific meaning for the trace id. It is up to the application to decide what the trace id means.

### Trace ID propagation in request body

ColdBrew makes it easier to propagate trace ids by providing the [TraceId interceptor] which will automatically add the trace id to the log context when the request specifies a `trace_id` field in the proto request.

```proto
message HelloRequest {
    string trace_id = 1;
    string msg = 2;
}

service HelloService {
    rpc Hello(HelloRequest) returns (HelloResponse) {
        option (google.api.http) = {
            get: "/hello"
        };
    }
}
```

### Trace ID propagation in request headers

ColdBrew also allows you to propagate trace id in request headers by passing in the header `X-Trace-Id` in the request. This is useful when you have a service does not have `trace_id` field in the request and you want to propagate the trace id.

You can configure the trace id header name using the [SetTraceHeaderName] function from the notifier package:

```go
import (
    "github.com/go-coldbrew/errors/notifier"
)

func init() {
    // set trace header name to X-Trace-Id (default is "x-trace-id")
    notifier.SetTraceHeaderName("X-Trace-Id")
}
```

You can also configure this using the `TRACE_HEADER_NAME` environment variable.

{: .note}
Its important to note that the trace id header name is case insensitive. So `X-Trace-Id` and `x-trace-id` are the same.

{: .important}
It is recommended to use the [TraceId interceptor] to propagate trace ids in the request body. This is because the trace id as part of the request makes in implicit and easier to propagate. You do not have to worry about the header name or forgetting to send a request header.

## Overriding log level at request time

It is useful to be able to override the log level at request time. This is useful when you want to be able to debug a request in production without having to redeploy the service or updating the default log level. ColdBrew provides a way to do this by using [OverrideLogLevel] which will override the log level for the request different from the global log level


```go
import (
    "github.com/go-coldbrew/log"
    "github.com/go-coldbrew/log/loggers"
)

func init() {
    // set global log level to info
    // this is typically set by the ColdBrew cookiecutter using the LOG_LEVEL environment variable
    log.SetLevel(loggers.InfoLevel)
}

func handler(w http.ResponseWriter, r *http.Request) {
    ctx = r.Context()
    ctx = loggers.AddToLogContext(ctx, "request-id", "1234")
    ctx = loggers.AddToLogContext(ctx, "trace", "5678")
    ctx = loggers.AddToLogContext(ctx, "user-id", "abcd")

    // read request and do something

    // override log level for this request to debug
    ctx = log.OverrideLogLevel(ctx, loggers.DebugLevel)
    helloWorld(ctx)

    // do something else
}

func helloWorld(ctx context.Context) {
    log.Debug(ctx, "Hello World")
}

```

Will output the debug log messages even when the global log level is set to info

```json
{"level":"debug","msg":"Hello World","request-id":"1234","trace":"5678","user-id":"abcd","@timestamp":"2020-05-04T15:04:05.000Z"}
```

---
[TraceId interceptor]: https://pkg.go.dev/github.com/go-coldbrew/interceptors#TraceIdInterceptor
[go-coldbrew/tracing]: https://pkg.go.dev/github.com/go-coldbrew/tracing
[ColdBrew cookiecutter]: /getting-started
[interceptors]: https://pkg.go.dev/github.com/go-coldbrew/interceptors
[UseColdBrewServcerInterceptors]: https://pkg.go.dev/github.com/go-coldbrew/interceptors#UseColdBrewServerInterceptors
[OverrideLogLevel]: https://github.com/go-coldbrew/log#func-overrideloglevel
[Config]: https://pkg.go.dev/github.com/go-coldbrew/core/config#Config
[SetTraceHeaderName]: https://pkg.go.dev/github.com/go-coldbrew/errors/notifier#SetTraceHeaderName
