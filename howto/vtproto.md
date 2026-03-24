---
layout: default
title: "VTProtobuf (Fast Serialization)"
parent: "How To"
description: "How ColdBrew uses vtprotobuf for faster gRPC serialization with automatic fallback to standard protobuf"
---
## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

## Overview

ColdBrew uses [vtprotobuf](https://github.com/planetscale/vtprotobuf) (by PlanetScale) as the default gRPC serialization codec. vtprotobuf generates optimized `MarshalVT()` and `UnmarshalVT()` methods that are significantly faster than the standard `proto.Marshal()` — typically **2–3x faster** with fewer allocations.

This is enabled by default. You don't need to do anything to benefit from it — if your proto messages have VT methods generated, ColdBrew uses them automatically.

## How it works

At startup, ColdBrew registers a custom gRPC codec that replaces the default protobuf serializer. The codec uses a **three-level fallback chain** so it's backward compatible with any proto message:

```
Marshal:
  1. vtprotoMessage  →  MarshalVT()        (fastest, if VT methods exist)
  2. proto.Message   →  proto.Marshal()     (standard protobuf v2)
  3. protov1.Message →  protov1.Marshal()   (legacy protobuf v1)

Unmarshal:
  1. vtprotoMessage  →  UnmarshalVT()
  2. proto.Message   →  proto.Unmarshal()
  3. protov1.Message →  protov1.Unmarshal()
```

This means:
- Messages with VT methods get the fast path automatically
- Messages without VT methods (e.g., from third-party libraries) still work via standard protobuf
- No code changes needed — the codec switch is transparent

The codec also includes panic recovery with async error notification, so a serialization bug won't crash your service silently.

{: .note }
The vtproto codec only affects **gRPC wire protocol** serialization. The HTTP/JSON gateway uses grpc-gateway's own marshallers (`ProtoMarshaller` or `JSONBuiltin`) independently — they are not affected by this setting.

## Code generation setup

The [ColdBrew cookiecutter] template includes vtprotobuf in `buf.gen.yaml` out of the box:

```yaml
- remote: buf.build/community/planetscale-vtprotobuf:v0.6.0
  out: proto
  opt: paths=source_relative,features=marshal+unmarshal+size+clone+pool+equal
```

This generates the following methods on every proto message:

| Feature | Generated Method | Use Case |
|---------|-----------------|----------|
| `marshal` | `MarshalVT()` | Fast serialization (used by gRPC codec) |
| `unmarshal` | `UnmarshalVT()` | Fast deserialization (used by gRPC codec) |
| `size` | `SizeVT()` | Pre-calculate serialized size without allocating |
| `clone` | `CloneVT()` | Deep copy a message efficiently |
| `pool` | `ReturnToVTPool()` | Object pooling to reduce GC pressure |
| `equal` | `EqualVT()` | Fast message comparison |

After running `make generate` (or `buf generate`), your proto files will have `*_vtproto.pb.go` files alongside the standard `*.pb.go` files.

### Adding vtprotobuf to an existing project

If you're not using the cookiecutter template, add the vtprotobuf plugin to your `buf.gen.yaml`:

```yaml
plugins:
  # ... your existing plugins ...
  - remote: buf.build/community/planetscale-vtprotobuf:v0.6.0
    out: proto
    opt: paths=source_relative,features=marshal+unmarshal+size+clone+pool+equal
```

Then add the dependency to your `go.mod`:

```bash
go get github.com/planetscale/vtprotobuf
```

Regenerate your proto code:

```bash
buf generate
```

That's it — ColdBrew's codec will automatically detect and use the VT methods on your messages.

## Using VT features in your code

Beyond the automatic marshal/unmarshal speedup, you can use the generated methods directly:

### Cloning messages

```go
// Deep copy without reflection
original := &pb.MyMessage{Name: "test", Items: []*pb.Item{{Id: 1}}}
cloned := original.CloneVT()
// Modify cloned without affecting original
cloned.Items[0].Id = 2
```

### Comparing messages

```go
// Fast equality check
if msg1.EqualVT(msg2) {
    // messages are identical
}
```

### Object pooling

For high-throughput services, object pooling reduces GC pressure:

```go
msg := pb.MyMessageFromVTPool()
// ... use msg ...
msg.ReturnToVTPool()
```

{: .warning }
Only use pooling when you're sure the message won't be accessed after returning it to the pool. This is an advanced optimization — the marshal/unmarshal speedup alone is usually sufficient.

### Pre-calculating size

```go
// Useful for capacity planning or pre-allocating buffers
size := msg.SizeVT()
buf := make([]byte, 0, size)
```

## Disabling vtprotobuf

To fall back to standard protobuf marshalling:

```bash
export DISABLE_VT_PROTOBUF=true
```

You might want to disable it when:
- **Debugging serialization issues** — to isolate whether a bug is in vtprotobuf or your proto definitions
- **Compatibility testing** — to verify your service works with standard protobuf
- **Profiling** — to measure the actual performance difference in your workload

{: .note }
Disabling vtprotobuf only affects the gRPC codec. The generated `*_vtproto.pb.go` files remain in your codebase and the VT methods are still available for direct use (e.g., `CloneVT()`).

## How the codec is registered

For those curious about the internals, ColdBrew registers the codec during server initialization:

```go
// core/initializers.go
func InitializeVTProto() {
    encoding.RegisterCodec(vtprotoCodec{})
}
```

This is called from `processConfig()` in `core/core.go` when `DisableVTProtobuf` is `false` (the default). The codec registers itself with the name `"proto"`, replacing gRPC's default protobuf codec globally for the process.

---
[vtprotobuf]: https://github.com/planetscale/vtprotobuf
[ColdBrew cookiecutter]: /cookiecutter-reference
[Configuration Reference]: /config-reference
