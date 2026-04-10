---
layout: default
title: "Authentication"
parent: "How To"
nav_order: 18
description: "Adding JWT and API key authentication to ColdBrew gRPC services using go-grpc-middleware auth interceptors"
---
## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

## Overview

ColdBrew does not enforce a specific authentication mechanism, but the [cookiecutter template][ColdBrew cookiecutter] includes ready-to-use examples for **JWT** and **API key** authentication built on top of [go-grpc-middleware/v2 auth](https://github.com/grpc-ecosystem/go-grpc-middleware/tree/main/interceptors/auth).

Auth is config-controlled — the interceptors are always wired in your generated project via `service/auth/auth.go`. To enable authentication, just set the corresponding environment variable. No code changes needed.

{: .note .note-info }
User-added interceptors run **first** in the ColdBrew interceptor chain — before timeout, rate limiting, logging, and metrics. This means authentication is enforced before any other processing.

## JWT authentication

The JWT example uses [golang-jwt/jwt/v5](https://github.com/golang-jwt/jwt) — the most widely used Go JWT library — with HMAC-SHA256. It extracts the token from the `Authorization: Bearer <token>` gRPC metadata header. The library supports all standard signing algorithms (HMAC, RSA, ECDSA, EdDSA) and handles claims validation (expiry, not-before, issuer) out of the box.

### Enabling

Set the `JWT_SECRET` environment variable:

```yaml
env:
  - name: JWT_SECRET
    valueFrom:
      secretKeyRef:
        name: my-service-secrets
        key: jwt-secret
```

That's it — the auth interceptors are registered automatically when the env var is set.

### Accessing claims in handlers

The JWT interceptor puts parsed claims into the request context. Access them with `auth.ClaimsFromContext`:

```go
import "your-module/service/auth"

func (s *svc) MyMethod(ctx context.Context, req *pb.MyRequest) (*pb.MyResponse, error) {
    claims := auth.ClaimsFromContext(ctx)
    if claims == nil {
        // Should not happen — interceptor rejects unauthenticated requests
        return nil, status.Error(codes.Internal, "missing claims")
    }
    log.Info(ctx, "msg", "request from", "subject", claims.Subject)
    // ...
}
```

### Using RSA or ECDSA keys

The default uses HMAC-SHA256 (symmetric) — faster and simpler, ideal for **internal service-to-service** auth where both sides share the secret. Use asymmetric keys (RSA, ECDSA) when tokens are issued by an **external identity provider** (Auth0, Keycloak, Google) where you only have the public key.

To switch, modify `JWTAuthFunc` in `service/auth/auth.go` — change the `keyFunc` to return your public key and update the `WithValidMethods` list. See the [golang-jwt/jwt documentation](https://github.com/golang-jwt/jwt) for:

- [RSA parsing example](https://pkg.go.dev/github.com/golang-jwt/jwt/v5#example-Parse-Rsa)
- [Custom claims structs](https://pkg.go.dev/github.com/golang-jwt/jwt/v5#example-ParseWithClaims-CustomClaimsType)
- [JWKS key sets](https://github.com/MicahParks/keyfunc) for validating tokens from external identity providers (Auth0, Keycloak, etc.)

## API key authentication

The API key example validates keys from the `x-api-key` gRPC metadata header against a configured set of valid keys.

### Enabling

Set the `API_KEYS` environment variable (comma-separated list):

```yaml
env:
  - name: API_KEYS
    valueFrom:
      secretKeyRef:
        name: my-service-secrets
        key: api-keys
```

That's it — the auth interceptors are registered automatically when the env var is set.

### Sending API keys from clients

**gRPC (Go):**
```go
md := metadata.Pairs("x-api-key", "my-api-key")
ctx := metadata.NewOutgoingContext(ctx, md)
resp, err := client.MyMethod(ctx, req)
```

**HTTP (via grpc-gateway):**
```bash
curl -H "x-api-key: my-api-key" http://localhost:9091/api/v1/my-endpoint
```

{: .note .note-info }
For HTTP requests via grpc-gateway, ensure `x-api-key` is included in `HTTP_HEADER_PREFIXES` so it is forwarded as gRPC metadata. Add `x-api-key` to the config: `HTTP_HEADER_PREFIXES=x-api-key`.

## Skipping auth for health checks

By default, the auth interceptor applies to **all** RPCs including health and readiness checks. To skip authentication for specific methods, your service can implement the `ServiceAuthFuncOverride` interface from go-grpc-middleware:

```go
import (
    grpcauth "github.com/grpc-ecosystem/go-grpc-middleware/v2/interceptors/auth"
    "your-module/service/auth"
)

// AuthFuncOverride bypasses the global auth interceptor for specific methods.
func (s *svc) AuthFuncOverride(ctx context.Context, fullMethodName string) (context.Context, error) {
    // Skip auth for health and readiness checks
    switch fullMethodName {
    case "/grpc.health.v1.Health/Check",
         "/grpc.health.v1.Health/Watch":
        return ctx, nil
    }
    // Fall through to the global auth function for all other methods
    return auth.JWTAuthFunc(s.jwtSecret)(ctx)
}

// Compile-time check
var _ grpcauth.ServiceAuthFuncOverride = (*svc)(nil)
```

## Authorization

Authentication answers "who are you?" — authorization answers "what can you do?". ColdBrew does not provide a built-in authorization framework, but gRPC-Go has native support for policy-based authorization:

- **[grpc-go/authz](https://github.com/grpc/grpc-go/tree/master/authz)** — CEL-based policy engine built into gRPC-Go. Define allow/deny rules as JSON policies, evaluated per-RPC. Supports matching on method names, metadata headers, and authenticated identity.

For most services, a simple per-method check in your handler (using claims from the auth interceptor) is sufficient. Use `grpc-go/authz` when you need externalized, policy-driven access control.

## Further reading

- [go-grpc-middleware/v2 auth](https://github.com/grpc-ecosystem/go-grpc-middleware/tree/main/interceptors/auth) — the `AuthFunc` pattern used by these examples
- [grpc-go/authz](https://github.com/grpc/grpc-go/tree/master/authz) — gRPC-native policy-based authorization
- [golang-jwt/jwt](https://github.com/golang-jwt/jwt) — the JWT library used in the example
- [Security hardening guide](/howto/production/#security-hardening) — TLS, admin port isolation, and other production security measures

[ColdBrew cookiecutter]: /getting-started
