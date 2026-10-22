# Docker instalado — Matías Porcari

**Objetivo:** verificar que Docker Desktop (backend WSL 2) y el plugin Compose funcionan en
la máquina (sección 5 del TP).

```powershell
wsl --status
docker --version
docker compose version
docker info
docker run --rm hello-world
```

## Salida obtenida

Corrida del 2026-10-22 en Windows 11 con Docker Desktop sobre WSL 2.

```text
PS> wsl --status
Distribución predeterminada: Ubuntu
Versión predeterminada: 2

PS> docker --version
Docker version 29.7.2, build a7dcaa6

PS> docker compose version
Docker Compose version v5.4.0

PS> docker info --format 'Server Version: {{.ServerVersion}} | OS: {{.OperatingSystem}} | Kernel: {{.KernelVersion}} | CPUs: {{.NCPU}} | Memoria: {{.MemTotal}} | Storage Driver: {{.Driver}}'
Server Version: 29.7.2 | OS: Docker Desktop | Kernel: 6.18.33.2-microsoft-standard-WSL2 | CPUs: 16 | Memoria: 7155122176 | Storage Driver: overlayfs

PS> docker run --rm hello-world

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
```

**Resultado:** ✅ Docker Engine 29.7.2 y Compose 5.4.0 funcionan sobre WSL 2; `hello-world`
corre.

> En Windows, Docker Desktop tiene que estar abierto: si no, los comandos fallan con
> `failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`.
