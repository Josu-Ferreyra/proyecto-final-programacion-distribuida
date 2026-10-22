# Evidencia · Docker (Santiago Vicente)

Sección 5.3 del TP6. Windows 10 Enterprise con Docker Desktop sobre WSL 2, capturado el 22/10/2026.

Para que Docker Desktop arrancara hubo que activar la *Plataforma de máquina virtual* de Windows
(desde PowerShell como administrador) y reiniciar:

```powershell
dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
bcdedit /set hypervisorlaunchtype auto
```

```text
$ wsl --status
Distribución predeterminada: docker-desktop
Versión predeterminada: 2

$ docker --version
Docker version 29.9.2, build a82e528

$ docker compose version
Docker Compose version v5.6.1

$ docker info (resumen)
Server Version: 29.9.2
Operating System: Docker Desktop
OSType: linux / Architecture: x86_64
CPUs: 8 / Memoria: 8298106880 bytes

$ docker run --rm hello-world
Unable to find image 'hello-world:latest' locally
latest: Pulling from library/hello-world
4f55086f7dd0: Pulling fs layer
d5e71e642bf5: Download complete
4f55086f7dd0: Download complete
4f55086f7dd0: Pull complete
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
