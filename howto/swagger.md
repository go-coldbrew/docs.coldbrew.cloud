---
layout: default
title: "Swagger / Open API Support"
parent: "How To"
description: "How ColdBrew supports Swagger / Open API"
---
## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

{: .important}
This page is only applicable to applications using `go-coldbrew/core` package and applications created by [ColdBrew cookiecutter].

## Overview

ColdBrew supports [Swagger](https://swagger.io/) / [Open API](https://www.openapis.org/) out of the box. ColdBrew automatically generates Swagger / Open API specification for your APIs.

This makes it easy to use tools like [Swagger UI](https://swagger.io/tools/swagger-ui/) to explore and test your APIs. ColdBrew also bundles [Swagger UI](https://swagger.io/tools/swagger-ui/) and serves it at the `/swagger/` URL on the ColdBrew server.

Since ColdBrew using grpc-gateway to generate RESTful APIs, the generated Swagger / Open API specification is based on the [grpc-gateway's Open API specification] documentation.

## Adding OpenAPI annotations to your APIs

To learn how to add OpenAPI annotations to your APIs, please refer to [grpc-gateway's Swagger / Open API specification] documentation.

## How to access the Swagger / Open API specification

You can access the generated Swagger / Open API specification at the `/swagger/` URL on the ColdBrew server. For example, if your ColdBrew server is running on `http://localhost:9091`, you can access the Swagger at [http://localhost:9091/swagger/](http://localhost:9091/swagger/) and Open API specification [http://localhost:9091/swagger/myapp.swagger.json](http://localhost:9091/swagger/myapp.swagger.json)

![](/assets/images/swagger.png)

## Configuration

### Disable Swagger / Open API serving

You can disable the Swagger / Open API serving by setting the `DISABLE_SWAGGER` environment variables to `true` in the [Config].

### Change the Swagger / Open API serving URL

You can change the Swagger / Open API serving URL by setting the `SWAGGER_URL` environment variables in the [Config].

### Change the Swagger / Open API serving handler

You can change the Swagger / Open API serving handler by calling [SetOpenAPIHandler] function in your application code before calling `CB.Run()`. For example, if you want to serve the Swagger / Open API specification using your own custom handler, you can do the following:

```go

import (
    "net/http"

    "github.com/go-coldbrew/core"
)

// openAPIHandler is the custom handler that serves the OpenAPI specification
func openAPIHandler(w http.ResponseWriter, r *http.Request) {
    ...
}

// main is the entry point of the service
// This is where the ColdBrew framework is initialized and the service is started
func main() {
	// Initialize the ColdBrew framework with the given configuration
	// This is a good place to customise the ColdBrew framework configuration if needed
	cb := core.New(cfg)
	// Set the OpenAPI handler that is used by the ColdBrew framework to serve the OpenAPI UI
	cb.SetOpenAPIHandler(openAPIHandler)
	// Register the service implementation with the ColdBrew framework
	err := cb.SetService(&cbSvc{})
	if err != nil {
		// If there is an error registering the service implementation, panic and exit
		panic(err)
	}

	// Start the service and wait for it to exit
	// This is a blocking call and will not return until the service exits completely
	log.Error(context.Background(), cb.Run())
}
```

---
[grpc-gateway's Swagger / Open API specification]: https://grpc-ecosystem.github.io/grpc-gateway/docs/tutorials/adding_annotations/
[Config]: https://pkg.go.dev/github.com/go-coldbrew/core/config#Config
[SetOpenAPIHandler]: https://pkg.go.dev/github.com/go-coldbrew/core#CB
[grpc-gateway's Open API specification]: https://grpc-ecosystem.github.io/grpc-gateway/docs/mapping/customizing_openapi_output/
[ColdBrew cookiecutter]: /getting-started
