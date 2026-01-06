---
layout: default
title: "Errors"
parent: "How To"
description: "How to use go-coldbrew/errors package to handle errors in Go."
---
## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

## Overview

Errors are a part of life. They are a part of every application. ColdBrew provides a simple way to handle errors in Go.

It provides an [errors package] which is a drop-in replacement for the standard `errors` package. It also provides a [notifier package] to notify errors to different error tracking providers like [Sentry], [Airbrake], [Rollbar] etc. It enables you to switch between them without changing your code.

## ColdBrew errors package

The ColdBrew [errors package] provides a simple way to handle errors in Go. It is inspired by [Dave Cheney's blog post](https://dave.cheney.net/2016/04/27/dont-just-check-errors-handle-them-gracefully) and [pkg/errors] package. It is a drop-in replacement for the standard `errors` package.

### Using

The ColdBrew [errors package] can be used any where an error is being returned. It can be used in place of the standard `errors` package.


Lets say you have a function that returns an error.

```go

import (
    "errors"
)

func somefunction() error {
    ...
    return errors.New("error message")
}
```

You can use the ColdBrew [errors package] by replacing the import for the standard `errors` package with the `github.com/go-coldbrew/errors`.

```go

import (
    "github.com/go-coldbrew/errors"
)

func somefunction() error {
    ...
    return errors.New("error message")
}
```

### Wrapping errors

The ColdBrew [errors package] provides a `Wrap` function that can be used to wrap an error with a message. This is useful when you want to add more context to an error.

```go

import (
    "github.com/go-coldbrew/errors"
)

func function1() error {
    ...
    return errors.New("error message")
}

func function2() error {
    ...
    err := function1()
    return errors.Wrap(err, "some context")
}
```

## ColdBrew notifier package

The ColdBrew [notifier package] provides a simple way to notify errors to different notifiers like [Sentry], [Airbrake], [Rollbar] etc.

### Using

The ColdBrew [notifier package] works together with the ColdBrew [errors package].

To use the ColdBrew [notifier package], you need to import the `github.com/go-coldbrew/errors/notifier` package, and call the `Notify` function.

```go

import (
    "github.com/go-coldbrew/errors"
    "github.com/go-coldbrew/errors/notifier"
)

func function1() error {
    ...
    return errors.New("error message")
}

func function2 (ctx context.Context) {
    ...
    err := function1()
    notifier.Notify(err, ctx)
    ...
}
```

The `Notify` function takes multiple arguments, the error and additional data. A context can be used to add context aware fields to the logs. The context is optional, if you don't want to add context aware fields to the notifiers/logs, you don't have to pass in the context.

### Initialising

The ColdBrew [notifier package] can be initialised using the respective `Init` function for the notifier you want to use. [InitSentry] for Sentry, [InitAirbrake] for Airbrake, [InitRollbar] for Rollbar etc.

```go

import (
    "github.com/go-coldbrew/errors/notifier"
)

func main() {
    notifier.InitSentry("dsn")
    ...
}
```

{: .note}
You can use multiple notifiers at the same time. For example, you can use Sentry and Airbrake at the same time. This is useful when you want to use a different notifier for different environments or when you want to migrate from one provider to another.

### Advanced notification functions

#### Notify with custom level

Use [NotifyWithLevel] to report errors with a specific severity level:

```go
// Notify with a specific error level ("error", "warning", "info", etc.)
notifier.NotifyWithLevel(err, "warning", ctx)
```

#### Skip stack frames

Use [NotifyWithLevelAndSkip] when you have wrapper functions and need to skip stack frames for accurate reporting:

```go
// Skip 2 stack frames when reporting (useful for wrapper functions)
notifier.NotifyWithLevelAndSkip(err, 2, "error", ctx)
```

#### Log-only errors

Use [NotifyWithExclude] to log errors locally but exclude them from being sent to error tracking providers:

```go
// Report error to logs but don't send to Sentry/Airbrake/Rollbar
notifier.NotifyWithExclude(err, ctx)
```

#### Panic recovery

Use [NotifyOnPanic] in a defer statement to capture and report panics:

```go
func handler(ctx context.Context) {
    defer notifier.NotifyOnPanic(ctx, "additional data")
    // ... code that might panic
}
```

### Configuring trace header

The trace header is used to propagate trace IDs across services. You can customize the header name:

```go
import "github.com/go-coldbrew/errors/notifier"

func init() {
    // Set custom trace header name (default: "x-trace-id")
    notifier.SetTraceHeaderName("X-Request-Id")
}

// Get current trace header name
name := notifier.GetTraceHeaderName()
```

## Examples

### Sending errors to provides

The ColdBrew [notifier package] can be used to send errors to different providers like [Sentry], [Airbrake], [Rollbar] etc.

```go

import (
    "github.com/go-coldbrew/errors"
    "github.com/go-coldbrew/errors/notifier"
)

func function1() error {
    ...
    return errors.New("error message")
}

func function2 (ctx context.Context) {
    ...
    err := function1()
    notifier.Notify(err, ctx)
    ...
}
```

Will send the error to the configured notifier.

### Stack trace in logs

Errors created/wrapped using the ColdBrew [errors package] will have a stack trace in the logs when `notifier.Notify` is called. This is useful when you want to know where the error occurred.

```go

import (
    "github.com/go-coldbrew/errors"
    "github.com/go-coldbrew/errors/notifier"
)

func function1() error {
    ...
    return errors.New("error message")
}

func function2 (ctx context.Context) {
    ...
    err := function1()
    notifier.Notify(err, ctx)
    ...
}

```

Will output the following in the logs and the error will be sent to the configured notifier.

```json
{
  "@timestamp": "2023-04-24T11:15:00.353194+08:00",
  "caller": "service/service.go:33",
  "err": "error message",
  "grpcMethod": "/com.github.ankurs.MySvc/Error",
  "level": "error",
  "stack": [
    {
      "file": "service/service.go",
      "line": 28,
      "function": "function1"
    },
    {
      "file": "service/service.go",
      "line": 32,
      "function": "function2"
    },
    {...}
  ],
  "trace": "d0e63d6e-1929-428b-b1eb-4f47197e2f35"
}
```

You can see the `trace`, `caller`, `stack`, `grpcMethod` fields in the logs. The `trace` field is the unique identifier for the request. The `caller` field is the file and line number where the error occurred. The `stack` field is the stack trace of the error. The `grpcMethod` field is the gRPC method name where the error occurred.


{: .note}
the `trace` and `grpcMethod` fields are added by the ColdBrew, for more information on how to add these fields to the logs, see [context aware logs].

---
[errors package]: https://pkg.go.dev/github.com/go-coldbrew/errors
[notifier package]: https://pkg.go.dev/github.com/go-coldbrew/errors/notifier
[pkg/errors]: https://pkg.go.dev/github.com/pkg/errors
[context aware logs]: /howto/Log#context-aware-logs
[Sentry]: https://sentry.io
[Airbrake]: https://airbrake.io
[Rollbar]: https://rollbar.com
[InitSentry]: https://pkg.go.dev/github.com/go-coldbrew/errors/notifier#InitSentry
[InitAirbrake]: https://pkg.go.dev/github.com/go-coldbrew/errors/notifier#InitAirbrake
[InitRollbar]: https://pkg.go.dev/github.com/go-coldbrew/errors/notifier#InitRollbar
[NotifyWithLevel]: https://pkg.go.dev/github.com/go-coldbrew/errors/notifier#NotifyWithLevel
[NotifyWithLevelAndSkip]: https://pkg.go.dev/github.com/go-coldbrew/errors/notifier#NotifyWithLevelAndSkip
[NotifyWithExclude]: https://pkg.go.dev/github.com/go-coldbrew/errors/notifier#NotifyWithExclude
[NotifyOnPanic]: https://pkg.go.dev/github.com/go-coldbrew/errors/notifier#NotifyOnPanic
[SetTraceHeaderName]: https://pkg.go.dev/github.com/go-coldbrew/errors/notifier#SetTraceHeaderName
[GetTraceHeaderName]: https://pkg.go.dev/github.com/go-coldbrew/errors/notifier#GetTraceHeaderName
