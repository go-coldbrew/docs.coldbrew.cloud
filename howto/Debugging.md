---
layout: default
title: "Debugging"
parent: "How To"
description: "Debugging ColdBrew services with pprof and log overrides"
---
## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

## pprof

Golang provides a built-in profiler called [pprof](https://golang.org/pkg/net/http/pprof/). It is a tool that can be used to collect CPU and memory profiles. It can be used to collect profiles from a running application and then analyze them to find the root cause of performance issues.

ColdBrew exposes `/debug/pprof/` endpoint on the HTTP port that can be used to collect profiles. The endpoint is only available when the [configuration option] `DisableDebug` is set to `false` (which is the default behaviour).

### Collecting profiles

To collect a profile, you can use the `go tool pprof` command. For example, to collect a CPU profile, you can run the following command:

```bash
$ go tool pprof http://localhost:9091/debug/pprof/profile
```

This will open an interactive shell where you can run commands to analyze the profile. For example, to see the top 10 functions that are consuming the most CPU, you can run the following command:

```bash
(pprof) top5
Showing nodes accounting for 30ms, 100% of 30ms total
Showing top 5 nodes out of 45
      flat  flat%   sum%        cum   cum%
      20ms 66.67% 66.67%       20ms 66.67%  runtime.memclrNoHeapPointers
      10ms 33.33%   100%       10ms 33.33%  syscall.syscall
         0     0%   100%       20ms 66.67%  github.com/NYTimes/gziphandler.GzipHandlerWithOpts.func1.1
         0     0%   100%       10ms 33.33%  github.com/ankurs/MyApp/proto.(*mySvcClient).Echo
         0     0%   100%       20ms 66.67%  github.com/ankurs/MyApp/proto.RegisterMySvcHandlerClient.func3
```

### Analyzing profiles

The `go tool pprof` command can also be used to analyze profiles to find the root cause of performance issues. For more information, please refer to the [pprof walkthrough] and the [diagnostics doc].

{: .important }
Its recommended that you go though the [pprof walkthrough] to get a better understanding of how to use the pprof.

### Disabling pprof endpoint

The pprof endpoint can be disabled by setting the [configuration option] `DisableDebug` or the environment variable `DISABLE_DEBUG` to `true`. This is useful if you want to disable the `/debug/pprof/` endpoint in production.

{: .note .note-info }
Its recommended to only expose the endpoint that are used by clients, and disable the rest of the endpoints at the load balancer level by using a whitelist.

## Overriding log level at request time

ColdBrew provides a way to override the log level of a request based on the request parameters. This can be useful when you want to log a request at a different log level than the default log level. For example, you can log a request at the `debug` log level when a `debug` query parameter is present in the request.

For information on this feature, please refer to the [Overriding log level at request time] page.

## Debugging with Delve

[Delve](https://github.com/go-delve/delve) is the standard Go debugger. To debug a ColdBrew service:

```bash
# Install delve
go install github.com/go-delve/delve/cmd/dlv@latest

# Run your service under delve
dlv debug . -- [flags]

# Or attach to a running process
dlv attach $(pgrep myservice)
```

### Useful breakpoint locations

When debugging ColdBrew services, these are good places to set breakpoints:

- **Your handler**: `break service/service.go:42` — your gRPC method implementation
- **Interceptor chain entry**: `break github.com/go-coldbrew/interceptors.UnaryServerInterceptor` — see what interceptors fire
- **Error notification**: `break github.com/go-coldbrew/errors/notifier.Notify` — catch when errors are sent to Sentry/Rollbar

### VS Code / GoLand

Both IDEs support Delve natively. Configure Delve to listen on its own port (for example, set `"host": "0.0.0.0", "port": 2345` in your launch.json) and keep this distinct from your service ports (gRPC on 9090, HTTP on 9091) to avoid conflicts.

## gRPC debugging environment variables

Go's gRPC library has built-in debug logging. These environment variables are useful when troubleshooting connectivity or protocol issues:

```bash
# Enable gRPC internal logging (WARNING: very verbose)
export GRPC_GO_LOG_VERBOSITY_LEVEL=99
export GRPC_GO_LOG_SEVERITY_LEVEL=info
```

This will print detailed gRPC transport and connection state information to stderr. Useful for diagnosing:
- Connection establishment failures
- TLS handshake issues
- Load balancer resolution problems
- Keepalive/ping timeouts

{: .warning }
Do not enable verbose gRPC logging in production — it generates enormous log volume and may impact performance.

## Inspecting the interceptor chain

ColdBrew chains interceptors in a specific order. If you're not sure what's running, you can inspect the chain at startup by setting `LOG_LEVEL=debug`:

```bash
LOG_LEVEL=debug make run
```

The server interceptor chain runs in this order:
1. Response time logging
2. Trace ID injection
3. Context tags
4. OpenTracing/OpenTelemetry
5. Prometheus metrics
6. Error notification
7. NewRelic
8. Panic recovery

If a request is failing or behaving unexpectedly, check whether an interceptor is modifying the context or returning early. The response time logging interceptor logs every request with method name and duration — check these logs first.

## Common error patterns

### "transport is closing"
Usually means the client connection was closed before the response arrived. Check:
- `SHUTDOWN_DURATION_IN_SECONDS` is long enough for your slowest requests
- Client-side timeouts match server-side processing time
- Load balancer idle timeout isn't shorter than your keepalive settings

### "context deadline exceeded"
The request's context expired. This propagates through the interceptor chain. Check:
- Client-side deadline/timeout settings
- Whether a downstream dependency (database, external API) is slow
- Circuit breaker state via Prometheus metrics

### Metrics endpoint returns 404
Prometheus is disabled. Check `DISABLE_PROMETHEUS` environment variable (should be `false` or unset).

### Health check returns error
The service hasn't called `SetReady()` yet. This typically happens during startup while dependencies are initializing. Check your service's `InitGRPC` method.

---
[configuration option]: https://pkg.go.dev/github.com/go-coldbrew/core/config#Config
[Overriding log level at request time]: /howto/Log/#overriding-log-level-at-request-time
[diagnostics doc]: https://go.dev/doc/diagnostics#profiling
[pprof walkthrough]: https://go.dev/blog/pprof
