---
layout: default
title: "Building and Configuring APIs"
parent: "How To"
---
## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

## Introduction

Coldbrew is gRPC first, which means that gRPC APIs are the primary APIs and HTTP/JSON APIs are generated from the gRPC APIs. This approach is different from other frameworks where HTTP/JSON APIs are independent from gRPC APIs.

Coldbrew uses [grpc-gateway] to generate HTTP/JSON APIs from gRPC APIs. It reads protobuf service definitions and generates a reverse-proxy server which translates a RESTful HTTP API into gRPC. This server is generated according to the [google.api.http annotations] in your service definitions.

{: .note}
To learn more about HTTP to gRPC API mapping please refer to [gRPC Gateway mapping] examples.

### Adding a new API to your service

To add a new API endpoint, you need to add a new method to your service definition and annotate it with the [google.api.http annotations]. The following example shows how to add a new API endpoint to the [example service]:

```proto
syntax = "proto3";
package example.v1;

service MySvc {
  ....
  rpc Upper(UpperRequest) returns (UpperResponse) {
    option (google.api.http) = {
      post: "/api/v1/example/upper"
      body: "*"
    };
  }
  ...
}
message UpperRequest{
    string msg = 1;
}

message UpperResponse{
    string msg = 1;
}
```

The above example adds a new API endpoint to the service which converts the input string to upper case. The endpoint is available at `/api/v1/example/upper` on the HTTP port and `example.v1.MySvc/Upper` on the gRPC port.

Run `make generate` (for [Coldbrew cookiecutter]) or `protoc`/`buf`  with [grpc-gateway plugin] for others to generate the gRPC and HTTP code.

In your service implement the gRPC server interface

```go
// Upper returns the message in upper case
func (s *svc) Upper(_ context.Context, req *proto.UpperRequest) (*proto.UpperResponse, error) {
    return &proto.UpperResponse{
        Msg: strings.ToUpper(req.GetMsg()),
    }, nil
}
```

Run your server (`make run` for [Coldbrew cookiecutter]) and send a request to the HTTP endpoint:

```bash
$ curl -X POST -d '{"msg":"hello"}' -i http://localhost:9091/api/v1/example/upper
HTTP/1.1 200 OK
Content-Type: application/json
Grpc-Metadata-Content-Type: application/grpc
Vary: Accept-Encoding
Date: Sun, 23 Apr 2023 07:48:34 GMT
Content-Length: 15

{"msg":"HELLO"}%
```
or the gRPC endpoint:

```bash
$ grpcurl -plaintext -d '{"msg": "hello"}' localhost:9090 example.v1.MySvc/Upper
{
  "msg": "HELLO"
}
```

## HTTP Content-Type

Coldbrew supports multiple content-types for requests and responses. The default content-type is `application/json`. The following content-types are supported by default:

- `application/json`
- `application/proto`
- `application/protobuf`

Lets assume the following proto definition:

```proto
message EchoRequest{
  string msg = 1;
}
message EchoResponse{
  string msg = 1;
}

service MySvc {
  rpc Echo(EchoRequest) returns (EchoResponse) {
    option (google.api.http) = {
      post: "/api/v1/example/echo"
      body: "*"
    };
    option (grpc.gateway.protoc_gen_openapiv2.options.openapiv2_operation) = {
      summary: "Echo endpoint"
      description: "Provides an echo reply endpoint."
      tags: "echo"
    };
  }
}
```

and the following service implementation:

```go
// Echo returns the message with the prefix added
func (s *svc) Echo(_ context.Context, req *proto.EchoRequest) (*proto.EchoResponse, error) {
	return &proto.EchoResponse{
		Msg: fmt.Sprintf("%s: %s", "echo", req.GetMsg()),
	}, nil
}
```

{: .note}
when *Content-Type* or *Accept* is not specified in the request header, the default content-type of `application/json` is used.

### JSON request, JSON response

When we send a curl call to the endpoint, we get the following response:

```bash
 $ curl -X POST -d '{"msg":"hello"}' -i http://127.0.0.1:9091/api/v1/example/echo
HTTP/1.1 200 OK
Content-Type: application/json
Grpc-Metadata-Content-Type: application/grpc
Vary: Accept-Encoding
Date: Sun, 23 Apr 2023 13:42:37 GMT
Content-Length: 20

{"msg":"echo: hello"}%
```

### JSON request, Proto response

We can send a proto request and get a proto response by specifying the *Accept* header:

```bash
curl -X POST -H 'Accept: application/proto' -d '{"msg":"hello"}' -i http://127.0.0.1:9091/api/v1/example/echo
HTTP/1.1 200 OK
Content-Type: application/octet-stream
Grpc-Metadata-Content-Type: application/grpc
Vary: Accept-Encoding
Date: Sun, 23 Apr 2023 13:46:47 GMT
Content-Length: 12


echo: hello%
```

### Proto request, Proto response

We can send a proto request and get a JSON response by specifying the *Content-Type* header:

```bash
$ echo 'msg: "proto message"' | protoc --encode=EchoRequest proto/app.proto | curl -sS -X POST --data-binary @- -H 'Content-Type: application/proto' -i http://127.0.0.1:9091/api/v1/example/echo
HTTP/1.1 200 OK
Content-Type: application/octet-stream
Grpc-Metadata-Content-Type: application/grpc
Vary: Accept-Encoding
Date: Sun, 23 Apr 2023 14:07:38 GMT
Content-Length: 20


echo: proto message%
```

## Returning HTTP status codes from gRPC APIs

### Overview

gRPC provides a set of standard response messages that can be used to return errors from gRPC APIs. These messages are defined in the [google/rpc/status.proto].

```proto
// The `Status` type defines a logical error model that is suitable for
// different programming environments, including REST APIs and RPC APIs. It is
// used by [gRPC](https://github.com/grpc). Each `Status` message contains
// three pieces of data: error code, error message, and error details.
//
// You can find out more about this error model and how to work with it in the
// [API Design Guide](https://cloud.google.com/apis/design/errors).
message Status {
  // The status code, which should be an enum value of
  // [google.rpc.Code][google.rpc.Code].
  int32 code = 1;

  // A developer-facing error message, which should be in English. Any
  // user-facing error message should be localized and sent in the
  // [google.rpc.Status.details][google.rpc.Status.details] field, or localized
  // by the client.
  string message = 2;

  // A list of messages that carry the error details.  There is a common set of
  // message types for APIs to use.
  repeated google.protobuf.Any details = 3;
}
```
### gRPC status codes and HTTP status codes mapping

gRPC status codes can be easlity translated to HTTP status codes. The following table shows the mapping between the canonical error codes and HTTP status codes:

| gRPC status code      | HTTP status code |
| --------------------  | ---------------- |
| `OK`                  | 200              |
| `INVALID_ARGUMENT`    | 400              |
| `OUT_OF_RANGE`        | 400              |
| `FAILED_PRECONDITION` | 400              |
| `PERMISSION_DENIED`   | 403              |
| `NOT_FOUND`           | 404              |
| `ABORTED`             | 409              |
| `ALREADY_EXISTS`      | 409              |
| `RESOURCE_EXHAUSTED`  | 429              |
| `CANCELLED`           | 499              |
| `UNKNOWN`             | 500              |
| `UNIMPLEMENTED`       | 501              |
| `DEADLINE_EXCEEDED`   | 504              |

Full list of gRPC status codes can be found in the [google/rpc/code.proto] file.

### Returning errors from RPC

When the service returns an error from the rpc its mapped to http status code 500 by default. To return a different http status code, the service can return a `google.rpc.Status` message with the appropriate error code. The following example shows how to return a `google.rpc.Status` message with the `INVALID_ARGUMENT` error code:

```proto
    message GetBookRequest {
      string name = 1;
    }

    message GetBookResponse {
      Book book = 1;
    }

    service BookService {
      rpc GetBook(GetBookRequest) returns (GetBookResponse) {
        option (google.api.http) = {
          get: "/v1/{name=books/*}"
        };
      }
    }
```

```go

import (
  "google.golang.org/grpc/codes"
  "google.golang.org/grpc/status"
)

func (s *server) GetBook(ctx context.Context, req *pb.GetBookRequest) (*pb.Book, error) {
  if req.Name == "" {
    return nil, status.Errorf(codes.InvalidArgument, "Name argument is required")
  }
  ...
}

```

This will return a `google.rpc.Status` message with the `INVALID_ARGUMENT` error code in HTTP and gRPC:

```bash
$ grpcurl -plaintext -d '{"name": ""}' localhost:8080 BookService.GetBook
{
  "code": 3,
  "message": "Name argument is required"
}
```

```bash
$ curl -X GET -i localhost:8080/v1/books/
HTTP/1.1 400 Bad Request
Content-Type: application/json
Vary: Accept-Encoding
Date: Sun, 23 Apr 2023 06:23:43 GMT
Content-Length: 61

{"code":3,"message":"Name argument is required","details":[]}%
```

### Returning additional error details

The `google.rpc.Status` message can also be used to return additional error details. The following example shows how to return a `google.rpc.Status` message with the `INVALID_ARGUMENT` error code and additional error details:

```proto
    message GetBookRequest {
      string name = 1;
    }

    message GetBookResponse {
      Book book = 1;
    }

    service BookService {
      rpc GetBook(GetBookRequest) returns (GetBookResponse) {
        option (google.api.http) = {
          get: "/v1/{name=books/*}"
        };
      }
    }
```

```go
import (
  "google.golang.org/grpc/codes"
  "google.golang.org/grpc/status"
  "google.golang.org/genproto/googleapis/rpc/errdetails"
)

func (s *server) GetBook(ctx context.Context, req *pb.GetBookRequest) (*pb.Book, error) {
  if req.Name == "" {
    st := status.New(codes.InvalidArgument, "Name argument is required")
    st, _ = st.WithDetails(&errdetails.BadRequest_FieldViolation{
      Field:       "name",
      Description: "Name argument is required",
    })
    return nil, st.Err()
  }
  ...
}
```

This will output

```bash
$ grpcurl -plaintext -d '{"name": ""}' localhost:8080 BookService.GetBook
{
  "code": 3,
  "message": "Name argument is required",
  "details": [
    {
      "@type": "type.googleapis.com/google.rpc.BadRequest",
      "fieldViolations": [
        {
          "field": "name",
          "description": "Name argument is required"
        }
      ]
    }
  ]
}
```

```bash
$ curl -X GET localhost:8080/v1/books/
{
  "code": 3,
  "message": "Name argument is required",
  "details": [
    {
      "@type": "type.googleapis.com/google.rpc.BadRequest",
      "fieldViolations": [
        {
          "field": "name",
          "description": "Name argument is required"
        }
      ]
    }
  ]
}
```

### Using Coldbrew errors package

All the above examples can be used with the [Coldbrew errors package] by using the functions `NewWithStatus/WrapWithStatus`

```go
import (
  "github.com/go-coldbrew/errors"
  "google.golang.org/grpc/codes"
  "google.golang.org/grpc/status"
  "google.golang.org/genproto/googleapis/rpc/errdetails"
)

func (s *server) GetBook(ctx context.Context, req *pb.GetBookRequest) (*pb.Book, error) {
  if req.Name == "" {
    st := status.New(codes.InvalidArgument, "Name argument is required")
    st, _ = st.WithDetails(&errdetails.BadRequest_FieldViolation{
      Field:       "name",
      Description: "Name argument is required",
    })
    return nil, errors.NewWithStatus("Name argument is required", st)
  }
  ...
}
```

Using the `errors.WrapWithStatus` function has the same effect as `errors.Wrap` but it also sets the status code of the error to the status code of the `google.rpc.Status` message. Similarly, the `errors.NewWithStatus` function has the same effect as `errors.New` but it also sets the status code of the error to the status code of the `google.rpc.Status` message.

Coldbrew errors package also provides stack trace support for errors, which can make debugging easier. For more information see Coldbrew [errors package].

## Customizing HTTP Error Responses

By default, grpc-gateway returns errors in the following JSON format:

```json
{
  "code": 3,
  "message": "Name argument is required",
  "details": []
}
```

You may want to customize this error response structure to match your API conventions, support legacy clients, or provide additional context. grpc-gateway provides the `WithErrorHandler` option to achieve this.

### Custom Error Handler

To customize the error response format, create a custom error handler and pass it to the `runtime.NewServeMux()`:

```go
package main

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// CustomError defines your desired error response structure
type CustomError struct {
	Error ErrorDetail `json:"error"`
}

type ErrorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// CustomErrorHandler handles gRPC errors and writes custom JSON response
func CustomErrorHandler(
	ctx context.Context,
	mux *runtime.ServeMux,
	marshaler runtime.Marshaler,
	w http.ResponseWriter,
	r *http.Request,
	err error,
) {
	// Extract gRPC status from the error
	st, ok := status.FromError(err)
	if !ok {
		st = status.New(codes.Unknown, err.Error())
	}

	// Build custom error response
	customErr := CustomError{
		Error: ErrorDetail{
			Code:    st.Code().String(),
			Message: st.Message(),
		},
	}

	// Set content type and HTTP status code
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(runtime.HTTPStatusFromCode(st.Code()))

	// Write the custom JSON response
	json.NewEncoder(w).Encode(customErr)
}
```

### Integrating with ColdBrew

In your `InitHTTP` function, apply the custom error handler to the existing mux before registering your service handlers:

```go
func (s *cbSvc) InitHTTP(ctx context.Context, mux *runtime.ServeMux, endpoint string, opts []grpc.DialOption) error {
	// Apply custom error handler to the existing mux
	runtime.WithErrorHandler(CustomErrorHandler)(mux)

	return proto.RegisterMyServiceHandlerFromEndpoint(ctx, mux, endpoint, opts)
}
```

{: .note}
This works because `runtime.ServeMuxOption` is defined as `func(*ServeMux)`, allowing you to apply options to an existing mux by calling the option function directly.

### Using with runtime.NewServeMux

If you're managing your own gateway setup (without ColdBrew core), pass the option when creating the ServeMux:

```go
mux := runtime.NewServeMux(
	runtime.WithErrorHandler(CustomErrorHandler),
)
```

### Example Response

With the custom error handler above, when your gRPC service returns an `InvalidArgument` error:

```go
return nil, status.Errorf(codes.InvalidArgument, "Name argument is required")
```

The HTTP response will be:

```bash
$ curl -X GET localhost:8080/v1/books/
HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "error": {
    "code": "InvalidArgument",
    "message": "Name argument is required"
  }
}
```

Instead of the default format:

```json
{"code":3,"message":"Name argument is required","details":[]}
```

{: .note}
For more advanced customization options, refer to the [grpc-gateway customization guide].

---
[google/rpc/status.proto]: https://github.com/googleapis/googleapis/blob/master/google/rpc/status.proto
[google/rpc/code.proto]: https://github.com/googleapis/googleapis/blob/master/google/rpc/code.proto
[Coldbrew errors package]: https://pkg.go.dev/github.com/go-coldbrew/errors#NewWithStatus
[errors package]: https://pkg.go.dev/github.com/go-coldbrew/errors
[envconfig]: https://github.com/kelseyhightower/envconfig
[Coldbrew]: https://docs.coldbrew.cloud
[google.api.http annotations]: https://cloud.google.com/endpoints/docs/grpc/transcoding
[grpc-gateway]: https://grpc-ecosystem.github.io/grpc-gateway/
[gRPC Gateway mapping]: https://grpc-ecosystem.github.io/grpc-gateway/docs/mapping/examples/
[grpc-gateway plugin]: https://grpc-ecosystem.github.io/grpc-gateway/docs/tutorials/generating_stubs/
[Coldbrew cookiecutter]: /getting-started#using-the-coldbrew-cookiecutter-template
[grpc-gateway customization guide]: https://grpc-ecosystem.github.io/grpc-gateway/docs/mapping/customizing_your_gateway/
