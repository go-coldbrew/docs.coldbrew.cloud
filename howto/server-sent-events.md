---
layout: default
title: "Server-Sent Events (SSE)"
parent: "How To"
nav_order: 22
description: "Server-Sent Events over the ColdBrew HTTP gateway — browser-consumable streaming for AI/LLM tokens, progress feeds, and live updates with built-in EventSource support and per-token cancellation"
---
# Server-Sent Events (SSE)

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

ColdBrew exposes every server-streaming gRPC method as Server-Sent Events for free. Any `rpc Foo(Req) returns (stream Resp)` endpoint is SSE-consumable when the client sends `Accept: text/event-stream` — no per-service wiring, no proto changes, no custom HTTP handler. This is the path of least resistance for AI/LLM token streams, progress feeds, change notifications, and any other server → client push that benefits from staying on plain HTTP.

The marshaler is registered by default. There is nothing to import in your service code. Clients pick SSE by sending `Accept: text/event-stream`; everything else continues to receive newline-delimited JSON as before.

Browser `EventSource(...)` is the simplest consumer but only does `GET` requests, so it works directly only for streams mapped to HTTP `GET`. For `POST`-mapped streams (most non-trivial endpoints), use `fetch` with a streaming response reader, or a small library like [microsoft/fetch-event-source](https://github.com/Azure/fetch-event-source) — the wire format is identical, only the request side changes.

## When to use SSE

| Use SSE for | Use something else for |
|---|---|
| AI/LLM token-by-token streaming | One-shot responses (unary RPC) |
| Server → client push (notifications, live counters, progress) | Bidirectional or high-frequency client → server messaging (WebSocket) |
| Browser clients you don't want to ship a gRPC-web library for | Server-to-server streams (use native gRPC) |
| Anything where a `curl -N` or `EventSource(...)` consumer is good enough | Binary streams (use the proto/protobuf gateway marshaler) |

If you need true bidi over HTTP, SSE is the wrong primitive — register a WebSocket handler via [HTTP Gateway Extensions](/howto/gateway-extensions). For server-only push, prefer SSE: it reuses your existing gRPC stream + gateway plumbing instead of doubling the surface area.

## Wire format

Each streamed gRPC message becomes one SSE frame:

```
data: {"result":{"token":"hello","index":0}}

data: {"result":{"token":"world","index":1}}

```

Two newlines (`\n\n`) terminate a frame, matching the SSE spec. The JSON payload uses protojson (same field naming and well-known-type handling as the gateway's default `application/json` responses).

{: .note }
grpc-gateway wraps server-streaming responses in `{"result": <message>}` over HTTP — this is the documented gateway convention, not an SSE artifact. Native gRPC clients still see the unwrapped message. If you need full control over the wire bytes (no `"result"` wrapper, custom `event:`/`id:` fields), use `google.api.HttpBody` as the stream's response type and marshal the SSE frame yourself in the handler.

## Defining a streaming endpoint

A streaming method is just a `stream` response in your `.proto`. Nothing changes for SSE specifically. Map to HTTP `GET` if you want browser `EventSource(...)` to consume it directly; use `POST` (and a streaming `fetch` client) when the request needs a body:

```protobuf
rpc StreamTokens(StreamTokensRequest) returns (stream Token) {
  option (google.api.http) = {
    // GET keeps the EventSource example below working as-is.
    // For POST, swap to: post: "/api/v1/stream/tokens" body: "*"
    get: "/api/v1/stream/tokens"
  };
}

message Token {
  string text = 1;
  int32 index = 2;
}
```

Implement using `grpc.ServerStreamingServer[Token]`:

```go
func (s *svc) StreamTokens(req *proto.StreamTokensRequest, stream grpc.ServerStreamingServer[proto.Token]) error {
    ctx := stream.Context()
    start := time.Now()

    for i, tok := range produce(ctx, req) {
        // Stop generating (and stop paying for) tokens when the client disconnects.
        // ctx.Err() goes non-nil when the HTTP connection drops — this is the
        // load-bearing safety property for AI/LLM workloads.
        if err := ctx.Err(); err != nil {
            return errors.Wrap(err, "stream canceled")
        }
        if err := stream.Send(&proto.Token{Text: tok, Index: int32(i)}); err != nil {
            return errors.Wrap(err, "stream send")
        }
        if i == 0 {
            metrics.ObserveTTFT(time.Since(start))
        }
    }
    return nil
}
```

Two things matter for production:

1. **Check `stream.Context().Err()` before every `Send`.** A browser tab closing cancels the HTTP context, which cancels the gRPC stream context. Pass the same context into your LLM SDK call so cancellation propagates to the upstream provider — otherwise the model keeps generating (and billing) after the user is gone.
2. **Record time-to-first-token (TTFT) as a distinct metric.** Total stream duration mixes upstream latency with generation throughput. Separating TTFT surfaces which one is degrading. Record it once per stream, on the first successful `Send`.

## Calling a streaming endpoint

### Browser (`EventSource`)

```javascript
const events = new EventSource("/api/v1/stream/tokens");
events.onmessage = (e) => {
  const frame = JSON.parse(e.data);
  console.log(frame.result.text); // unwrap the gateway envelope
};
events.onerror = () => events.close();
```

`EventSource` is the standard browser API — auto-reconnects on transient network failures, available in every modern browser, no dependencies. As noted in the intro, it only does `GET`; for `POST`-mapped streams use `fetch(..., { method: "POST" })` with a streaming response reader, or a library like [@microsoft/fetch-event-source](https://github.com/Azure/fetch-event-source) that handles POST + SSE parsing.

### curl

```console
$ # Default — newline-delimited JSON:
$ curl -N 'http://localhost:9091/api/v1/stream/tokens?msg=hello+world'

$ # SSE — request text/event-stream:
$ curl -N -H 'Accept: text/event-stream' \
    'http://localhost:9091/api/v1/stream/tokens?msg=hello+world'
```

`-N` (no-buffer) is required — without it, curl will hold the response until the stream completes.

For `POST`-mapped streams, the same flags apply; add `-X POST -H 'Content-Type: application/json' -d '{...}'` and replace the query string with a body. The wire format is identical.

### Native gRPC

The same method is reachable as a native gRPC server-streaming call. SSE is purely a gateway concern; gRPC clients see plain proto-encoded `Token` messages with no `{"result": ...}` wrapping.

## Disabling or replacing the default marshaler

Two opt-out paths:

| Goal | How |
|---|---|
| Turn off SSE entirely (force JSON for all streams) | Set `DISABLE_SSE_MARSHALER=true` |
| Keep SSE but customize the framing | Register your own `text/event-stream` marshaler from `PreStart` — see [HTTP Gateway Extensions](/howto/gateway-extensions). Service-registered marshalers win over ColdBrew's defaults on the same MIME |

A custom marshaler is the right answer when you need richer SSE features (named events via `event:`, IDs for client-side dedup via `id:`, multi-line `data:` fields). Embed `core.SSEMarshaler` and override `Marshal` to add the extra fields.

## Common pitfalls

- **Compression buffers SSE.** gzip/zstd over an event stream stalls frame delivery because compressors hold bytes until they have enough to flush. ColdBrew's HTTP compression wrapper automatically excludes `text/event-stream`, so this Just Works — but if you put a reverse proxy in front (Nginx, Cloudflare, an in-house CDN) and it re-applies compression, you'll see stalls. Send `Content-Encoding: identity` or configure the proxy to skip SSE.
- **Reverse proxies also buffer responses.** Nginx in particular holds chunks until ~4KB by default. Set `X-Accel-Buffering: no` on the response, or `proxy_buffering off;` for the upstream block. Cloudflare typically passes SSE through but check your zone settings.
- **`EventSource` can only `GET`.** If your RPC's HTTP annotation is `post`, use `fetch` with a streaming reader, or [microsoft/fetch-event-source](https://github.com/Azure/fetch-event-source). The streaming format on the wire is identical.
- **Mid-stream errors render in the trailers.** gRPC stream errors arrive after the last `Send`, encoded as a final SSE frame (or as HTTP trailers, depending on gateway config). For nicer client behavior — explicit error events the JS side can handle — use `runtime.WithStreamErrorHandler` to control the format.
- **The `{"result": ...}` wrapper is gateway-imposed.** It applies to every streaming RPC over HTTP, not just SSE. Either unwrap on the client (`JSON.parse(e.data).result`) or use `google.api.HttpBody` as the response type for full control.

## Related

- [Streaming RPCs](/howto/streaming-rpcs/) — Proto definitions, handler patterns, deadline propagation, and the gateway's behavior for every gRPC method shape.
- [HTTP Gateway Extensions](/howto/gateway-extensions/) — Registering custom marshalers, error handlers, middleware, and additional routes on the gateway.
- [Configuration Reference](/config-reference/) — `DISABLE_SSE_MARSHALER` and related HTTP gateway options.
- [Metrics](/howto/Metrics/) — Where to surface TTFT and per-stream counters alongside ColdBrew's default Prometheus metrics.
