---
layout: default
title: "Signal Handling and Graceful Shutdown"
parent: "How To"
nav_order: 9
description: "How POSIX signal handling works in ColdBrew"
---
## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}


{: .important}
This page is only applicable to applications using `go-coldbrew/core` package and applications created by [ColdBrew cookiecutter].

## Overview

ColdBrew applications are built on top of [go-coldbrew/core] package, have the ability to handle [POSIX signals].

This is useful when you want to gracefully shutdown your application, specially when you are running your application on a platform like [Kubernetes] that expects your application to gracefully shutdown during a rolling update or scale down.

## How it works

When you start your application, ColdBrew will register a signal handler for `SIGINT` and `SIGTERM` signals. When the application receives one of these signals, it will start a graceful shutdown process.

## Graceful shutdown

When the application receives a signal, ColdBrew executes a multi-step shutdown sequence:

1. **`PreStop(ctx)`** on services implementing [CBPreStopper] — deregister from service discovery, flush buffers
2. **`FailCheck(true)`** on services implementing [CBGracefulStopper] — `/readycheck` starts returning failure
3. **Wait** `GRPC_GRACEFUL_DURATION_IN_SECONDS` (default: 7s) for the load balancer to stop sending traffic
4. **Stop workers** — cancel worker context, wait for workers to exit
5. **Shutdown admin server** if configured (`ADMIN_PORT`)
6. **Shutdown HTTP server** — stop accepting new HTTP requests
7. **`GracefulStop()` gRPC server** — finish in-flight RPCs, reject new ones
8. **Force-stop gRPC server** if graceful shutdown didn't complete in time
9. **`Stop()`** on services implementing [CBStopper] — resource cleanup
10. **`PostStop(ctx)`** on services implementing [CBPostStopper] — final cleanup after everything stopped
11. **Exit**

## Customizing the shutdown process

Configuring the shutdown process is done by setting the [config] values:

- `SHUTDOWN_DURATION_IN_SECONDS` - Timeout for the entire `Stop()` sequence (default: 15s), covering steps 1-8 above including the drain wait. After this, the process exits regardless.
- `GRPC_GRACEFUL_DURATION_IN_SECONDS` - Duration of step 2 — how long to wait after failing `/readycheck` before stopping servers (default: 7s). This is **included within** `SHUTDOWN_DURATION_IN_SECONDS`, not additional to it.
- `DISABLE_SIGNAL_HANDLER` - If set to `true`, ColdBrew will not register a signal handler (useful when you want to handle signals yourself).

## Service lifecycle interfaces

ColdBrew provides optional interfaces for lifecycle hooks:

| Interface | Method | When called | Use for |
|-----------|--------|-------------|---------|
| [CBPreStopper] | `PreStop(ctx)` | Before FailCheck | Deregister from service discovery, flush buffers |
| [CBGracefulStopper] | `FailCheck(bool)` | Before drain wait | Mark service as not ready |
| [CBStopper] | `Stop()` | After servers stopped | Close DB pools, flush metrics, drain producers |
| [CBPostStopper] | `PostStop(ctx)` | After Stop, before exit | Final cleanup, audit log close |

{: .important}
All resource cleanup belongs in `Stop()`. ColdBrew calls it after all servers have stopped and in-flight requests have completed (or timed out).

## Cleanup before shutdown

Implement the [CBStopper] interface to clean up resources during shutdown:

```go
func (s *svc) Stop() {
    s.dbPool.Close()           // close database connections
    s.redisClient.Close()      // close Redis
    s.metricsReporter.Flush()  // flush pending metrics
    s.kafkaProducer.Close()    // drain and close Kafka producer
}
```

The [ColdBrew cookiecutter] generates this pattern — your service struct implements `CBStopper` and delegates to the service implementation's `Stop()` method.

## Kubernetes liveness and readiness probes

When you are running your application on [Kubernetes], you can configure your `livenessProbe` and `readinessProbe` to use the `/healthcheck` and `/readycheck` endpoints. This will ensure that your application is restarted if it is not responding to requests and that your application is not sent new requests when it is shutting down.

## Why do I see 5xx errors when my application is shutting down?

When you shut down your application, ColdBrew will fail the readiness check. This will cause the load balancer to stop sending new requests to your application. However, there might be some requests that are already in flight. These requests will still be processed by your application.

If you want to avoid this, you can set the `SHUTDOWN_DURATION_IN_SECONDS` to a value that is greater than the maximum time it takes to process a request. This will ensure that all requests are finished before the application shuts down. However, this will also increase the time it takes to shutdown the application.

Make sure you configure your load balancer to stop sending new requests to your application after readiness check fails. This will ensure that no new requests are sent to your application when it is shutting down.

---
[ColdBrew cookiecutter]: /getting-started
[go-coldbrew/core]: https://pkg.go.dev/github.com/go-coldbrew/core
[config]: https://pkg.go.dev/github.com/go-coldbrew/core/config#Config
[CBStopper]: https://pkg.go.dev/github.com/go-coldbrew/core#CBStopper
[CBGracefulStopper]: https://pkg.go.dev/github.com/go-coldbrew/core#CBGracefulStopper
[CBPreStopper]: https://pkg.go.dev/github.com/go-coldbrew/core#CBPreStopper
[CBPostStopper]: https://pkg.go.dev/github.com/go-coldbrew/core#CBPostStopper
[Kubernetes]: https://kubernetes.io/
[POSIX signals]: https://en.wikipedia.org/wiki/Signal_(IPC)#POSIX_signals
