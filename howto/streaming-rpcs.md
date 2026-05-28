---
layout: default
title: "Streaming RPCs"
parent: "How To"
nav_order: 21
description: "Server, client, and bidirectional streaming RPCs in ColdBrew — proto definitions, handler patterns, deadline propagation, backpressure, and grpc-gateway HTTP-streaming limits"
---
# Streaming RPCs

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

ColdBrew supports all four gRPC method shapes: unary, server-streaming, client-streaming, and bidirectional streaming. The default stream interceptor chain (response-time logging, protovalidate, metrics, panic recovery) is applied automatically — you don't need to opt in.

This page covers when to use each shape, the handler patterns, and the practical limits when serving the same methods through grpc-gateway over HTTP.

## When to use streaming

| Shape | When to use it | When **not** to |
|---|---|---|
| **Server-streaming** | Pushing a sequence of items the server already knows about — paginated results without round-trips, log tailing, change feeds, real-time updates. | One-shot responses (use unary). |
| **Client-streaming** | Uploading a large payload in chunks, accumulating samples, batch ingest. | When the server needs to acknowledge each item — you'd want bidi. |
| **Bidirectional** | Long-lived sessions where both sides send messages independently — chat, collaborative editing, multiplexed control channels. | When ordering between directions doesn't matter — server-streaming + a separate unary call is simpler. |

## Defining streaming methods

Use the `stream` keyword on the request, response, or both in your `.proto` file:

```protobuf
service Events {
  // Unary
  rpc GetEvent(GetEventRequest) returns (Event) {}

  // Server-streaming — one request, many responses
  rpc StreamEvents(StreamEventsRequest) returns (stream Event) {}

  // Client-streaming — many requests, one response
  rpc UploadSamples(stream Sample) returns (UploadSummary) {}

  // Bidirectional — many requests, many responses, independent timing
  rpc Chat(stream ChatMessage) returns (stream ChatMessage) {}
}
```

Run `buf generate` (or `make proto`) the same way you would for unary methods.

## Handler patterns

### Server-streaming

The handler receives the request and a stream it can `Send` on as many times as it wants:

```go
func (s *EventsService) StreamEvents(req *pb.StreamEventsRequest, stream pb.Events_StreamEventsServer) error {
    ctx := stream.Context()
    for ev := range s.subscribe(ctx, req.GetTopic()) {
        if err := stream.Send(ev); err != nil {
            // Client disconnected or context cancelled — stop producing.
            return err
        }
    }
    return nil
}
```

Two things to notice:
- **Always honour `stream.Context()`.** If the client disconnects or hits its deadline, the context is cancelled — your producer goroutine should exit.
- **`Send` returning an error means the stream is dead.** Don't keep producing.

### Client-streaming

The handler reads from the stream until `io.EOF`, then sends a single response:

```go
import "io"

func (s *EventsService) UploadSamples(stream pb.Events_UploadSamplesServer) error {
    var count int64
    for {
        sample, err := stream.Recv()
        if err == io.EOF {
            return stream.SendAndClose(&pb.UploadSummary{Count: count})
        }
        if err != nil {
            return err
        }
        count++
        // process sample
    }
}
```

`io.EOF` is the **expected** end-of-stream signal — it is not an error. Any other error means the client died or context was cancelled.

### Bidirectional

The simplest pattern is to read in a goroutine and write from the main goroutine (or vice versa). Use the stream's context to coordinate cancellation:

```go
import "io"

func (s *ChatService) Chat(stream pb.Chat_ChatServer) error {
    ctx := stream.Context()

    // Reader goroutine
    incoming := make(chan *pb.ChatMessage)
    errCh := make(chan error, 1)
    go func() {
        defer close(incoming)
        for {
            msg, err := stream.Recv()
            if err != nil {
                errCh <- err
                return
            }
            select {
            case incoming <- msg:
            case <-ctx.Done():
                return
            }
        }
    }()

    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case err := <-errCh:
            if err == io.EOF {
                return nil
            }
            return err
        case msg, ok := <-incoming:
            if !ok {
                // Reader closed the channel — wait for the error from errCh
                // on the next iteration so EOF and read errors propagate.
                incoming = nil
                continue
            }
            reply := s.handle(msg)
            if err := stream.Send(reply); err != nil {
                return err
            }
        }
    }
}
```

This shape generalizes to any independent-timing protocol. For half-duplex flows (every Recv followed by a Send), a simple `for { Recv; ... ; Send }` loop is fine — but you lose the ability to push unsolicited messages from the server.

## Deadline propagation

Stream contexts inherit the client's deadline the same way unary calls do. When the client sets a per-call deadline:

```go
ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
defer cancel()
stream, err := client.StreamEvents(ctx, req)
```

…then `stream.Context()` on the server side fires `Done()` at the same instant, and the next `Send` or `Recv` returns the cancellation error. **Always check `stream.Context().Err()` (or rely on `Send`/`Recv` returning) inside long-running loops** — that is your only signal to stop producing.

For long-lived streams (chat, change feeds), a single deadline rarely makes sense. Instead, set keepalive on the gRPC client/server (the cookiecutter sets sensible defaults) and let TCP failures surface as context cancellation.

## Backpressure

gRPC-Go does not expose explicit flow-control hooks — `Send` blocks once the HTTP/2 send window fills, and that **is** the backpressure signal. The patterns that stay healthy:

- **Producer-loop pattern.** Generate one item per loop iteration, call `stream.Send`, check the error, and only then move on. If the consumer is slow, your loop slows naturally.
- **Bounded buffer between source and stream.** If the data source can't be paced (e.g. it's a Kafka subscription), put a bounded channel between the source and the gRPC `Send` loop. When the channel fills, drop or block at the source — explicitly, not by accident.
- **Don't fan-out into goroutines per message.** Each `stream.Send` must complete before the next one starts; goroutines all calling `Send` on the same stream race.

If you need true high-throughput multiplexing on a single stream, consider chunking many logical messages into one large protobuf message instead of relying on per-message backpressure.

## grpc-gateway HTTP support

grpc-gateway translates streaming RPCs to HTTP, but the four shapes don't map cleanly to HTTP/1.1:

| gRPC shape | HTTP behaviour through the gateway |
|---|---|
| Unary | Standard request/response. |
| Server-streaming | Newline-delimited JSON (NDJSON) over a chunked HTTP response by default, or Server-Sent Events when the client sends `Accept: text/event-stream`. |
| Client-streaming | Limited — the gateway buffers and forwards as a unary gRPC stream. Don't rely on this for large or long-lived uploads. |
| Bidirectional | Limited — no true concurrent interleaving over HTTP/1.1. Avoid for HTTP clients. |

Practical things to know:

- **Server-Sent Events work out of the box.** ColdBrew registers a `text/event-stream` marshaler by default so any server-streaming RPC is consumable as SSE when the client sends `Accept: text/event-stream`. Browser `EventSource(...)` works directly for endpoints exposed via HTTP `GET`; for `POST`-mapped streams use `fetch` + [microsoft/fetch-event-source](https://github.com/Azure/fetch-event-source) (or any streaming HTTP client) — the wire format is identical. See [Server-Sent Events](/howto/server-sent-events/) for the framing, opt-out, and AI/LLM patterns; set `DISABLE_SSE_MARSHALER=true` to suppress.
- **Reverse proxies buffer streamed responses.** Nginx, Cloudflare, and similar will hold chunks until they have "enough." Set `X-Accel-Buffering: no` on the response (or the upstream config) to disable buffering when you actually need server-streaming over HTTP.
- **Stream errors need a handler.** Use `runtime.WithStreamErrorHandler` when registering the gateway to control how mid-stream errors render in the HTTP response. The default trailers-only behaviour is awkward to consume from a JSON client.
- **Bidirectional or push-style HTTP.** True bidi over HTTP/1.1 isn't viable through the gateway. For server → client push, prefer Server-Sent Events (above) over a separate WebSocket endpoint — it reuses the existing gRPC stream + gateway plumbing. WebSockets are still the right answer when you need client → server messages on the same connection; see [HTTP Gateway Extensions](/howto/gateway-extensions) for the registration recipe.

See the [grpc-gateway streaming examples](https://github.com/grpc-ecosystem/grpc-gateway/tree/main/examples/internal/proto/examplepb) for the full HTTP semantics.

## Related

- [APIs how-to](/howto/APIs) — Defining gRPC and HTTP endpoints from proto.
- [Interceptors](/howto/interceptors) — The stream interceptor chain and how to add your own.
- [Server-Sent Events](/howto/server-sent-events/) — Browser-consumable streams over the gateway, ideal for AI/LLM token streaming.
- [HTTP Gateway Extensions](/howto/gateway-extensions) — Custom marshalers and routes when the gateway alone isn't enough.
- [Tracing](/howto/Tracing) — Trace IDs propagate through stream contexts the same way they do for unary.
