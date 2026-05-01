---
layout: default
title: "HTTP Gateway Extensions"
parent: "How To"
nav_order: 20
description: "Register custom HTTP marshalers, middleware, error handlers, and other grpc-gateway ServeMuxOptions in a ColdBrew service"
---
## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

## Overview

ColdBrew builds the HTTP gateway on top of [grpc-gateway][grpc-gateway], which exposes its `runtime.ServeMux` configuration through `runtime.ServeMuxOption` values. Until recently, ColdBrew built that mux internally and didn't surface a way to plug in your own options.

`core` now exposes two registration functions for this:

```go
// Append any runtime.ServeMuxOption to the gateway's mux.
func RegisterServeMuxOption(opt runtime.ServeMuxOption)

// Convenience for the common case: register a marshaler for a MIME type.
// Equivalent to RegisterServeMuxOption(runtime.WithMarshalerOption(mime, m)).
func RegisterHTTPMarshaler(mime string, m runtime.Marshaler)
```

Use them to add custom marshalers (MessagePack, CBOR, vendor-specific JSON), tune the default protojson marshaler, register per-route middleware, install a custom error handler, or wire forward-response hooks — anything `runtime.ServeMuxOption` lets you do.

{: .note }
These functions follow ColdBrew's init-only configuration pattern. Call them **before** `core.Run()` — typically from a service's `PreStart` hook or a `package init`. They are **not** safe for concurrent registration and have no effect after the server is running.

## Ordering rules

Registered options are applied **after** ColdBrew's built-ins. Built-ins include:

- The incoming-header matcher derived from `HTTP_HEADER_PREFIXES`
- Marshalers for `application/proto` and `application/protobuf`
- The internal `spanRouteMiddleware` (sets the OTEL span name + `http.route` attribute)
- Optionally the JSON builtin marshaler when `USE_JSON_BUILTIN_MARSHALLER=true`

Because grpc-gateway's option model is last-write-wins for some options and additive for others, the practical effect is:

| Option type | Behavior when you register one |
|---|---|
| `WithMarshalerOption(mime, …)` | Overrides ColdBrew's marshaler for that MIME (last-write-wins) |
| `WithErrorHandler` / `WithRoutingErrorHandler` | Overrides the gateway default |
| `WithIncomingHeaderMatcher` | **Overrides `HTTP_HEADER_PREFIXES` wiring** — reimplement that matcher yourself if you still need it |
| `WithMiddlewares(…)` | Stacks **after** `spanRouteMiddleware` |
| `WithMetadata`, `WithForwardResponseOption` | Stack additively with the gateway defaults |

{: .warning }
Overriding `WithIncomingHeaderMatcher` silently disables the `HTTP_HEADER_PREFIXES` configuration. If you need both your custom matching and the prefix-forwarding behavior, port the prefix logic into your matcher.

## Recipe: MessagePack marshaler

The following ~80-line marshaler bridges proto ↔ msgpack via [protojson][protojson] for correctness on well-known types (`Timestamp`, `Duration`, oneofs, enums). Drop it into your service and register it from `PreStart`.

```go
package msgpackmarshaler

import (
    "bytes"
    "encoding/json"
    "errors"
    "io"

    "github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
    "github.com/shamaton/msgpack/v2"
    "google.golang.org/protobuf/encoding/protojson"
    "google.golang.org/protobuf/proto"
)

const ContentType = "application/msgpack"

type Marshaler struct{}

func (Marshaler) ContentType(any) string { return ContentType }

func (Marshaler) Marshal(v any) ([]byte, error) {
    msg, ok := v.(proto.Message)
    if !ok {
        return nil, errors.New("msgpack: value is not a proto.Message")
    }
    j, err := protojson.Marshal(msg)
    if err != nil {
        return nil, err
    }
    var generic any
    if err := json.Unmarshal(j, &generic); err != nil {
        return nil, err
    }
    return msgpack.Marshal(generic)
}

func (Marshaler) Unmarshal(data []byte, v any) error {
    msg, ok := v.(proto.Message)
    if !ok {
        return errors.New("msgpack: value is not a proto.Message")
    }
    var generic any
    if err := msgpack.Unmarshal(data, &generic); err != nil {
        return err
    }
    j, err := json.Marshal(generic)
    if err != nil {
        return err
    }
    return protojson.Unmarshal(j, msg)
}

func (m Marshaler) NewDecoder(r io.Reader) runtime.Decoder {
    return runtime.DecoderFunc(func(v any) error {
        b, err := io.ReadAll(r)
        if err != nil {
            return err
        }
        return m.Unmarshal(b, v)
    })
}

func (m Marshaler) NewEncoder(w io.Writer) runtime.Encoder {
    return runtime.EncoderFunc(func(v any) error {
        b, err := m.Marshal(v)
        if err != nil {
            return err
        }
        _, err = io.Copy(w, bytes.NewReader(b))
        return err
    })
}
```

Wire it from your service:

```go
import (
    coldbrew "github.com/go-coldbrew/core"
    "yourorg/yourservice/msgpackmarshaler"
)

func (s *Service) PreStart(ctx context.Context) error {
    coldbrew.RegisterHTTPMarshaler(msgpackmarshaler.ContentType, msgpackmarshaler.Marshaler{})
    coldbrew.RegisterHTTPMarshaler("application/x-msgpack", msgpackmarshaler.Marshaler{}) // legacy alias
    return nil
}
```

Now `curl -H 'Accept: application/msgpack' …` returns msgpack-encoded responses, and `Content-Type: application/msgpack` request bodies decode correctly.

{: .note }
The protojson hop costs about 2× a single marshal compared to a hand-written `protoreflect`-based encoder. For hot paths consider implementing a direct encoder; for typical request volumes the bridge is fast enough and dramatically simpler.

## Recipe: Tune the default JSON marshaler

ColdBrew's default for unknown `Content-Type`s — including `application/json` — is grpc-gateway's `runtime.JSONPb` (protojson). The defaults emit `camelCase` field names and omit zero values. Override the wildcard MIME to change that:

```go
import (
    "google.golang.org/protobuf/encoding/protojson"
    "github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
    coldbrew "github.com/go-coldbrew/core"
)

func (s *Service) PreStart(ctx context.Context) error {
    coldbrew.RegisterHTTPMarshaler(runtime.MIMEWildcard, &runtime.JSONPb{
        MarshalOptions: protojson.MarshalOptions{
            EmitUnpopulated: true,  // include zero-valued fields
            UseProtoNames:   true,  // snake_case instead of camelCase
            Indent:          "  ",  // pretty-print
        },
        UnmarshalOptions: protojson.UnmarshalOptions{
            DiscardUnknown: true, // ignore fields the server doesn't recognize
        },
    })
    return nil
}
```

## Recipe: Per-route middleware

`runtime.WithMiddlewares` middleware runs around every gateway-routed request and stacks with ColdBrew's internal middleware:

```go
import (
    "net/http"

    "github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
    coldbrew "github.com/go-coldbrew/core"
)

func requestSizeLimit(maxBytes int64) func(runtime.HandlerFunc) runtime.HandlerFunc {
    return func(next runtime.HandlerFunc) runtime.HandlerFunc {
        return func(w http.ResponseWriter, r *http.Request, p map[string]string) {
            r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
            next(w, r, p)
        }
    }
}

func (s *Service) PreStart(ctx context.Context) error {
    coldbrew.RegisterServeMuxOption(runtime.WithMiddlewares(requestSizeLimit(10 << 20)))
    return nil
}
```

## Recipe: Custom error handler

To override how grpc-gateway translates gRPC errors into HTTP responses (for example to emit a vendor-specific error envelope), register `WithErrorHandler`:

```go
import (
    "context"
    "net/http"

    "github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
    coldbrew "github.com/go-coldbrew/core"
    "google.golang.org/grpc/status"
)

func envelopeErrorHandler(ctx context.Context, mux *runtime.ServeMux, m runtime.Marshaler, w http.ResponseWriter, r *http.Request, err error) {
    s, _ := status.FromError(err)
    w.Header().Set("Content-Type", m.ContentType(nil))
    w.WriteHeader(runtime.HTTPStatusFromCode(s.Code()))
    payload := map[string]any{
        "error": map[string]any{
            "code":    s.Code().String(),
            "message": s.Message(),
        },
    }
    body, _ := m.Marshal(payload)
    _, _ = w.Write(body)
}

func (s *Service) PreStart(ctx context.Context) error {
    coldbrew.RegisterServeMuxOption(runtime.WithErrorHandler(envelopeErrorHandler))
    return nil
}
```

## When to reach for these hooks

- You need a wire format ColdBrew doesn't ship (msgpack, CBOR, YAML, vendor-specific binary).
- You want the defaults of `runtime.JSONPb` adjusted (field naming, empty-value emission, indentation).
- You need request-scoped concerns at the HTTP layer that don't fit in a gRPC interceptor (raw-body access, file uploads, response streaming wrappers, request size limits).
- You need a different error envelope than the gateway default.

For gRPC-side concerns — auth, rate limiting, metrics, retries — use [Interceptors](/howto/interceptors) instead. Interceptors run on the gRPC server itself and are independent of the HTTP gateway.

---

[grpc-gateway]: https://github.com/grpc-ecosystem/grpc-gateway
[protojson]: https://pkg.go.dev/google.golang.org/protobuf/encoding/protojson
[ColdBrew cookiecutter]: /getting-started
