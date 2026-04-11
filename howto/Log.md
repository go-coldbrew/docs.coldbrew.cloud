---
layout: default
title: "Log"
parent: "How To"
nav_order: 3
description: "Context-aware logging and trace ID propagation in ColdBrew"
---
## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

## Logging with slog

ColdBrew uses a custom `slog.Handler` that automatically injects per-request context fields (trace ID, gRPC method, HTTP path) into every log record. After `core.New()` initializes the framework, native `slog` calls work out of the box:

```go
import (
    "context"
    "log/slog"
)

func (s *svc) HandleOrder(ctx context.Context, req *proto.OrderRequest) (*proto.OrderResponse, error) {
    slog.LogAttrs(ctx, slog.LevelInfo, "order received",
        slog.String("order_id", req.GetOrderId()),
        slog.Int("items", len(req.GetItems())),
    )
    // ...
}
```

{: .note }
Use `slog.LogAttrs` with typed attribute constructors (`slog.String`, `slog.Int`, `slog.Duration`, etc.) for the best performance — they avoid `interface{}` boxing. `slog.InfoContext` and `slog.ErrorContext` also work but box all values through `any`.

### Custom handler configuration

To customize the handler (e.g., change output format or wrap with middleware like slog-multi):

```go
import (
    "github.com/go-coldbrew/log"
    "github.com/go-coldbrew/log/loggers"
)

func init() {
    log.SetDefault(log.NewHandler(
        loggers.WithJSONLogs(true),
        loggers.WithCallerInfo(true),
    ))
}
```

### Handler composability

ColdBrew's `Handler` is a standard `slog.Handler` — it can wrap any inner handler, and can itself be wrapped by handler middleware. All composition is done through the `log` package using `log.NewHandlerWithInner`.

**Custom inner handler** (e.g., write to a file instead of stdout):

```go
import (
    "log/slog"
    "os"
    "github.com/go-coldbrew/log"
)

func init() {
    f, _ := os.OpenFile("app.log", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
    inner := slog.NewJSONHandler(f, nil)
    log.SetDefault(log.NewHandlerWithInner(inner))
}
```

**Fan-out to multiple destinations** (e.g., stdout + file, using [slog-multi](https://github.com/samber/slog-multi)):

```go
import (
    "log/slog"
    "os"
    "github.com/go-coldbrew/log"
    slogmulti "github.com/samber/slog-multi"
)

func init() {
    stdout := slog.NewJSONHandler(os.Stdout, nil)
    file := slog.NewJSONHandler(logFile, nil)

    // ColdBrew wraps the fan-out handler — context fields appear in both outputs
    multi := slogmulti.Fanout(stdout, file)
    log.SetDefault(log.NewHandlerWithInner(multi))
}
```

**Wrapping ColdBrew's handler** (e.g., adding sampling on top):

```go
import (
    "log/slog"
    "github.com/go-coldbrew/log"
)

func init() {
    cbHandler := log.NewHandler()  // ColdBrew handler with default JSON output

    // Your custom middleware wraps ColdBrew's handler
    sampled := NewSamplingHandler(cbHandler, 0.1)  // sample 10% of logs
    slog.SetDefault(slog.New(sampled))
}
```

In all cases, `slog.LogAttrs` calls and ColdBrew context fields work automatically — the Handler injects context fields regardless of where it sits in the chain.

## Context-aware logs

ColdBrew provides a way to add per-request fields to the log context. Any fields added via `log.AddToContext` or `log.AddAttrsToContext` are automatically included in all log calls that use that context — both ColdBrew's `log.Info` and native `slog.LogAttrs`.

### Adding context fields

Use `log.AddAttrsToContext` for typed fields (zero boxing) or `log.AddToContext` for untyped key-value pairs:

```go
import (
    "context"
    "log/slog"
    "net/http"

    "github.com/go-coldbrew/log"
)

func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()

    // Typed attrs — the Handler recovers the slog.Attr at log time
    ctx = log.AddAttrsToContext(ctx,
        slog.String("request_id", "1234"),
        slog.String("user_id", "abcd"),
    )

    // Or untyped key-value pairs (simpler)
    ctx = log.AddToContext(ctx, "trace", "5678")

    helloWorld(ctx)
}

func helloWorld(ctx context.Context) {
    slog.LogAttrs(ctx, slog.LevelInfo, "Hello World")
}
```

Output:

```json
{"level":"info","msg":"Hello World","request_id":"1234","user_id":"abcd","trace":"5678","@timestamp":"2020-05-04T15:04:05.000Z"}
```

{: .note }
ColdBrew interceptors automatically add `grpcMethod`, trace ID, and HTTP path to the context — you don't need to add these yourself.

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
    "context"
    "log/slog"
    "net/http"

    "github.com/go-coldbrew/log"
    "github.com/go-coldbrew/log/loggers"
)

func init() {
    // set global log level to info
    // this is typically set by the ColdBrew framework using the LOG_LEVEL environment variable
    log.SetLevel(loggers.InfoLevel)
}

func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    ctx = log.AddAttrsToContext(ctx,
        slog.String("request_id", "1234"),
        slog.String("user_id", "abcd"),
    )

    // override log level for this request to debug
    ctx = log.OverrideLogLevel(ctx, loggers.DebugLevel)
    helloWorld(ctx)
}

func helloWorld(ctx context.Context) {
    // This debug message appears even though the global level is info,
    // because OverrideLogLevel was set on this request's context.
    slog.LogAttrs(ctx, slog.LevelDebug, "Hello World")
}
```

Output (debug log appears even when global level is info):

```json
{"level":"debug","msg":"Hello World","request_id":"1234","user_id":"abcd","@timestamp":"2020-05-04T15:04:05.000Z"}
```

### Production debugging with OverrideLogLevel + trace ID

ColdBrew's `DebugLogInterceptor` (enabled by default) automatically enables per-request debug logging when it detects:

1. **A proto field** — `bool debug = N` or `bool enable_debug = N` in the request message
2. **A metadata/HTTP header** — `x-debug-log-level: debug` (configurable via `DEBUG_LOG_HEADER_NAME`)

Combined with ColdBrew's automatic trace ID propagation, this lets you enable debug logging for a single request and follow it end-to-end across services via the trace ID.

**Why this is better than changing the global `LOG_LEVEL`:**
- **Zero blast radius** — only the targeted request gets debug logs; other requests stay at INFO
- **Works across services** — the trace ID follows the request through downstream gRPC calls
- **No restart needed** — the override is per-request, not per-process

**Proto field approach** (implicit — ColdBrew detects it automatically):

```protobuf
message MyRequest {
    string msg = 1;
    bool debug = 2;  // ColdBrew reads this automatically
}
```

**Header approach** (works with both gRPC and HTTP):

```bash
# gRPC
grpcurl -H "x-debug-log-level: debug" localhost:9090 myservice.MyService/MyMethod

# HTTP (via grpc-gateway)
curl -H "x-debug-log-level: debug" http://localhost:9091/api/v1/echo
```

See the [config reference](/config-reference) for `DISABLE_DEBUG_LOG_INTERCEPTOR` and `DEBUG_LOG_HEADER_NAME` settings.

---
[TraceId interceptor]: https://pkg.go.dev/github.com/go-coldbrew/interceptors#TraceIdInterceptor
[go-coldbrew/tracing]: https://pkg.go.dev/github.com/go-coldbrew/tracing
[ColdBrew cookiecutter]: /getting-started
[interceptors]: https://pkg.go.dev/github.com/go-coldbrew/interceptors
[UseColdBrewServcerInterceptors]: https://pkg.go.dev/github.com/go-coldbrew/interceptors#UseColdBrewServerInterceptors
[OverrideLogLevel]: https://github.com/go-coldbrew/log#func-overrideloglevel
[Config]: https://pkg.go.dev/github.com/go-coldbrew/core/config#Config
[SetTraceHeaderName]: https://pkg.go.dev/github.com/go-coldbrew/errors/notifier#SetTraceHeaderName
