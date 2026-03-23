---
layout: default
title: "Cookiecutter Setup"
nav_order: 3
description: "Detailed cookiecutter template setup for ColdBrew"
permalink: /getting-started
---
# Getting Started with ColdBrew
{: .no_toc }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

Let's pretend you want to create a project called "echoserver".

Rather than starting from scratch maybe copying some files and then editing the results to include your name, email, and various configuration issues that always get forgotten until the worst possible moment, get cookiecutter to do all the work.

## Prerequisites
First, get Cookiecutter. Trust me, it's awesome:

```shell
$ pip install cookiecutter
```

Alternatively, you can install `cookiecutter` with homebrew:

```shell
$ brew install cookiecutter
```
## Using the ColdBrew Cookiecutter Template

To run it based on this template, type:

```shell
$ cookiecutter gh:go-coldbrew/cookiecutter-coldbrew
```

You will be asked about your basic info \(name, project name, app name, etc.\). This info will be used to customise your new project.

## Providing your app information to the cookiecutter

{: .warning }
After this point, change 'github.com/ankurs', 'MyApp', etc to your own information.

Answer the prompts with your own desired options. For example:

{% highlight shell %}
source_path [github.com/ankurs]: github.com/ankurs
app_name [MyApp]: MyApp
grpc_package [github.com.ankurs]: github.com.ankurs
service_name [MySvc]: MySvc
project_short_description [A Golang project.]: A Golang project
docker_image [alpine:latest]:
docker_build_image [golang]:
Select docker_build_image_version:
1 - 1.25
2 - 1.24
Choose from 1, 2 [1]: 1
{% endhighlight %}

## Checkout your new project

Enter the project and take a look around:

```shell
$ cd MyApp/
$ ls
```

Run `make help` to see the available management commands, or just run `make build` to build your project.

```shell
$ make run
```

## Working with your new project

Your project is now ready to be worked on. You can find the generated `README.md` file in the project root directory. It contains a lot of useful information about the project. 

You can also find the generated `Dockerfile` and `Makefile` in the project root directory.  It contains a lot of useful commands to build, test, and run your project. You can run `make help` to see the available management commands.

## Next Steps

Now that you have a project, you might want to learn more about some of the [How To] in ColdBrew.

---
[How To]: /howto
