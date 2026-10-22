# Docker instalado — Josué Ferreyra

**Objetivo:** verificar que Docker Engine y el plugin Compose funcionan en la máquina
(sección 5 del TP).

```bash
docker --version
docker compose version
docker info
docker run --rm hello-world
```

## Salida obtenida

Corrida del 2026-10-20 en Arch Linux (Docker Engine con el plugin Compose, sin WSL).

```text
$ docker --version
Docker version 29.7.2, build a7dcaa6fdb

$ docker compose version
Docker Compose version 5.5.0

$ docker info --format 'Server Version: {{.ServerVersion}} | OS: {{.OperatingSystem}} | Kernel: {{.KernelVersion}} | CPUs: {{.NCPU}} | Memoria: {{.MemTotal}} | Storage Driver: {{.Driver}}'
Server Version: 29.7.2 | OS: Omarchy | Kernel: 6.18.13-arch1-1 | CPUs: 16 | Memoria: 16065417216 | Storage Driver: overlayfs

$ docker run --rm hello-world
Unable to find image 'hello-world:latest' locally
latest: Pulling from library/hello-world
Digest: sha256:11a3eb1597e864c51b3f56733cb2e8a90bf0c284bfc05f9444d81c558bc848aa
Status: Downloaded newer image for hello-world:latest

Hello from Docker!
This message shows that your installation appears to be working correctly.

To generate this message, Docker took the following steps:
 1. The Docker client contacted the Docker daemon.
 2. The Docker daemon pulled the "hello-world" image from the Docker Hub.
    (amd64)
 3. The Docker daemon created a new container from that image which runs the
    executable that produces the output you are currently reading.
 4. The Docker daemon streamed that output to the Docker client, which sent it
    to your terminal.

To try something more ambitious, you can run an Ubuntu container with:
 $ docker run -it ubuntu bash

Share images, automate workflows, and more with a free Docker ID:
 https://hub.docker.com/

For more examples and ideas, visit:
 https://docs.docker.com/get-started/
```

**Resultado:** ✅ Docker Engine 29.7.2 y Compose 5.5.0 funcionan; `hello-world` corre.
