---
layout: default
title: "Signal Handling and Graceful Shutdown"
parent: "How To"
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

When the application receives a signal, it will start a graceful shutdown process. This process will do the following:

  1. Fail the readiness check
  2. Wait for all requests to finish
  3. Shutdown the application when all requests are finished or after a timeout

## Customizing the shutdown process

Configuring the shutdown process is done by setting the [config] values:

- `SHUTDOWN_DURATION_IN_SECONDS` - The duration in seconds to wait for all requests to finish before shutting down the application.
- `GRPC_GRACEFUL_DURATION_IN_SECONDS` - The duration in seconds for which ColdBrew will wait for propagation of readiness check failure to the load balancer.
- `DISABLE_SIGNAL_HANDLER` - If set to `true`, ColdBrew will not register a signal handler (this is useful when you want to handle signals yourself).

## Cleanup before shutdown

If your service implements [CBStopper] interface, ColdBrew will call the `Stop` method when the application is shutting down. This is useful if you want to perform some cleanup before the application shuts down.

{: .important}
ColdBrew will call the `Stop` method after all requests have finished or after the `SHUTDOWN_DURATION_IN_SECONDS` timeout has expired.

## Kubernetes liveness and readiness probes

When you are running your application on [Kubernetes], you can configure your `livenessProbe` and `readinessProbe` to use the `/healthcheck` and `/readycheck` endpoints. This will ensure that your application is restarted if it is not responding to requests and that your application is not sent new requests when it is shutting down.

## Why do I see 5xx errors when my application is shutting down?

When you shut down your application, ColdBrew will fail the readiness check. This will cause the load balancer to stop sending new requests to your application. However, there might be some requests that are already in flight. These requests will still be processed by your application.

If you want to avoid this, you can set the `SHUTDOWN_DURATION_IN_SECONDS` to a value that is greater than the maximum time it takes to process a request. This will ensure that all requests are finished before the application shuts down. However, this will also increase the time it takes to shutdown the application.

Make sure you configure your load balancer to stop sending new requests to your application after readiness check fails. This will ensure that no new requests are sent to your application when it is shutting down.

---
[ColdBrew cookiecutter]: /cookiecutter-reference#using-the-coldbrew-cookiecutter-template
[go-coldbrew/core]: https://pkg.go.dev/github.com/go-coldbrew/core
[config]: https://pkg.go.dev/github.com/go-coldbrew/core/config#Config
[CBStopper]: https://pkg.go.dev/github.com/go-coldbrew/core#CBStopper
[Kubernetes]: https://kubernetes.io/
[POSIX signals]: https://en.wikipedia.org/wiki/Signal_(IPC)#POSIX_signals
