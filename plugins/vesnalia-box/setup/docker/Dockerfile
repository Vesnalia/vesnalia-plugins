# alia-box's images for the Docker backend: a linux image, a desktop image and
# a Wayland desktop image, made by the same guest scripts as the Proxmox LXC
# templates (setup/proxmox-lxc/template/guest), with BOX_RUNTIME=docker.
# build.sh builds them, with setup/ as the context; see README.md.

# Ubuntu 24.04, pinned, and no newer than the apt snapshot
# (proxmox-lxc/template/apt-snapshot): the build applies the snapshot's
# updates, and apt does not take a package back to an older version.
ARG UBUNTU=ubuntu:24.04@sha256:008173c23f95b170204355c12626cb5a965d779a7e1283b09e9cffbb1bf33ca3
# The Wayland desktop's base: Ubuntu 26.04, whose Sway and wayvnc carry the
# box's own pointer shapes, as the Proxmox LXC Wayland template is.
# resolute-20260912, pinned, and no newer than the apt snapshot, as above.
# The guest scripts take the release from the image.
ARG UBUNTU_WAYLAND=ubuntu:26.04@sha256:da6fc2be547864451aa253836dd926da33623312df4a9a243e35dc877c378a78

# The artifacts the guest scripts install, each checked against its pinned
# SHA-256, as fetch-artifacts.sh does on a Proxmox host. The pinned files are
# kept between builds in a cache on the Docker host, alia-box-artifacts, which
# holds the current pins' files only (#96).
FROM ${UBUNTU} AS fetch
# BuildKit's name for the platform's architecture, amd64 or arm64, as the
# guest scripts' pins name it, x86_64 or arm64.
ARG TARGETARCH
RUN --mount=type=bind,source=proxmox-lxc/template/guest/apt.sh,target=/mnt/apt.sh \
    bash /mnt/apt.sh update -q \
 && bash /mnt/apt.sh install -y -q --no-install-recommends ca-certificates curl jq \
 && rm -rf /var/lib/apt/lists/*
COPY proxmox-lxc/host/common.sh /src/host/
COPY proxmox-lxc/template/fetch-artifacts.sh proxmox-lxc/template/pins.json proxmox-lxc/template/desktop-pins.tsv /src/template/
RUN --mount=type=cache,id=alia-box-artifacts,target=/var/cache/alia-box-artifacts,sharing=locked \
    ALIABOX_ENV=/nonexistent ALIABOX_ALIA_URL= ALIABOX_ARTIFACT_CACHE=/var/cache/alia-box-artifacts bash /src/template/fetch-artifacts.sh /artifacts linux "$([ "$TARGETARCH" = arm64 ] && echo arm64 || echo x86_64)"

FROM fetch AS fetch-desktop
ARG TARGETARCH
RUN --mount=type=cache,id=alia-box-artifacts,target=/var/cache/alia-box-artifacts,sharing=locked \
    ALIABOX_ENV=/nonexistent ALIABOX_ALIA_URL= ALIABOX_ARTIFACT_CACHE=/var/cache/alia-box-artifacts bash /src/template/fetch-artifacts.sh /artifacts desktop-cpu "$([ "$TARGETARCH" = arm64 ] && echo arm64 || echo x86_64)"

FROM fetch AS fetch-desktop-wayland
ARG TARGETARCH
RUN --mount=type=cache,id=alia-box-artifacts,target=/var/cache/alia-box-artifacts,sharing=locked \
    ALIABOX_ENV=/nonexistent ALIABOX_ALIA_URL= ALIABOX_ARTIFACT_CACHE=/var/cache/alia-box-artifacts bash /src/template/fetch-artifacts.sh /artifacts desktop-wayland-cpu "$([ "$TARGETARCH" = arm64 ] && echo arm64 || echo x86_64)"

# ALIA's host app from ALIA's server, to pre-install it, so a box enrols without
# downloading it. Empty ALIA_URL: boxes download it when they enrol.
# ALIA_APP_SHA256 is the app's digest on the server, which build.sh reads: a new
# build of ALIA's app changes it, so the build fetches and installs the new app,
# and what comes before stays cached (#95).
FROM fetch AS app
ARG ALIA_URL=
ARG ALIA_APP_SHA256=
RUN mkdir /app && if [ -n "$ALIA_URL" ]; then \
      curl -fsS -D /app/alia-app.headers -o /app/alia-app.tgz "${ALIA_URL%/}/install/alia-app.tgz" && \
      { echo "$ALIA_APP_SHA256  /app/alia-app.tgz" | sha256sum -c --quiet - || { \
        echo "ALIA's app on $ALIA_URL is not the build $ALIA_APP_SHA256 that build.sh read: build again" >&2; exit 1; }; }; \
    fi

# Each image is one layer from Ubuntu's, then one with ALIA's app: customize.sh
# runs the guest scripts and finalize.sh together, so what finalize.sh removes
# takes no room. The app's layer comes last, as it changes with each build of
# ALIA's app, and aliabox.alia-app says which build it has, for the plugin to see.
FROM ${UBUNTU} AS linux
ARG IMAGE_SOURCES_SHA256=
RUN --mount=type=bind,source=proxmox-lxc/template,target=/mnt/template \
    --mount=type=bind,source=docker/customize.sh,target=/mnt/customize.sh \
    --mount=type=bind,from=fetch,source=/artifacts,target=/mnt/artifacts \
    --mount=type=bind,from=fetch,source=/etc/ssl/certs/ca-certificates.crt,target=/mnt/ca-certificates.crt \
    --mount=type=cache,id=alia-box-apt,target=/var/cache/alia-box-apt,sharing=locked \
    bash /mnt/customize.sh linux
ARG ALIA_URL=
ARG ALIA_APP_SHA256=
RUN --mount=type=bind,source=proxmox-lxc/template/guest/install-alia-app.sh,target=/mnt/install-alia-app.sh \
    --mount=type=bind,from=app,source=/app,target=/mnt/app \
    if [ -n "$ALIA_URL" ]; then \
      bash /mnt/install-alia-app.sh box "$ALIA_URL" /mnt/app && rm -rf /home/box/.npm /home/box/.cache /tmp/*; \
    fi
COPY --chmod=0755 docker/start /usr/local/sbin/alia-box-start
COPY --chmod=0755 docker/fork-hold /usr/local/libexec/alia-box/fork-hold
LABEL aliabox.image-version="1" aliabox.fork-hold="1" aliabox.alia-app="$ALIA_APP_SHA256"
CMD ["/usr/local/sbin/alia-box-start"]

FROM ${UBUNTU} AS desktop
ARG IMAGE_SOURCES_SHA256=
RUN --mount=type=bind,source=proxmox-lxc/template,target=/mnt/template \
    --mount=type=bind,source=docker/customize.sh,target=/mnt/customize.sh \
    --mount=type=bind,from=fetch-desktop,source=/artifacts,target=/mnt/artifacts \
    --mount=type=bind,from=fetch,source=/etc/ssl/certs/ca-certificates.crt,target=/mnt/ca-certificates.crt \
    --mount=type=cache,id=alia-box-apt,target=/var/cache/alia-box-apt,sharing=locked \
    bash /mnt/customize.sh desktop
ARG ALIA_URL=
ARG ALIA_APP_SHA256=
RUN --mount=type=bind,source=proxmox-lxc/template/guest/install-alia-app.sh,target=/mnt/install-alia-app.sh \
    --mount=type=bind,from=app,source=/app,target=/mnt/app \
    if [ -n "$ALIA_URL" ]; then \
      bash /mnt/install-alia-app.sh box "$ALIA_URL" /mnt/app && rm -rf /home/box/.npm /home/box/.cache /tmp/*; \
    fi
COPY --chmod=0755 docker/start /usr/local/sbin/alia-box-start
COPY --chmod=0755 docker/fork-hold /usr/local/libexec/alia-box/fork-hold
COPY --chmod=0755 docker/gpu-bus-id /usr/local/libexec/alia-box/gpu-bus-id
# aliabox.gpu-bus-id: start points Xorg at the GPU placed, so the plugin may
# give a GPU desktop Docker (#283).
LABEL aliabox.image-version="1" aliabox.gpu-bus-id="1" aliabox.fork-hold="1" aliabox.alia-app="$ALIA_APP_SHA256"
CMD ["/usr/local/sbin/alia-box-start"]

# The Wayland desktop (048): Sway on the CPU, streamed by wayvnc, with no GPU.
FROM ${UBUNTU_WAYLAND} AS desktop-wayland
ARG IMAGE_SOURCES_SHA256=
RUN --mount=type=bind,source=proxmox-lxc/template,target=/mnt/template \
    --mount=type=bind,source=docker/customize.sh,target=/mnt/customize.sh \
    --mount=type=bind,from=fetch-desktop-wayland,source=/artifacts,target=/mnt/artifacts \
    --mount=type=bind,from=fetch,source=/etc/ssl/certs/ca-certificates.crt,target=/mnt/ca-certificates.crt \
    --mount=type=cache,id=alia-box-apt,target=/var/cache/alia-box-apt,sharing=locked \
    bash /mnt/customize.sh desktop-wayland
ARG ALIA_URL=
ARG ALIA_APP_SHA256=
RUN --mount=type=bind,source=proxmox-lxc/template/guest/install-alia-app.sh,target=/mnt/install-alia-app.sh \
    --mount=type=bind,from=app,source=/app,target=/mnt/app \
    if [ -n "$ALIA_URL" ]; then \
      bash /mnt/install-alia-app.sh box "$ALIA_URL" /mnt/app && rm -rf /home/box/.npm /home/box/.cache /tmp/*; \
    fi
COPY --chmod=0755 docker/start /usr/local/sbin/alia-box-start
COPY --chmod=0755 docker/fork-hold /usr/local/libexec/alia-box/fork-hold
LABEL aliabox.image-version="1" aliabox.fork-hold="1" aliabox.alia-app="$ALIA_APP_SHA256"
CMD ["/usr/local/sbin/alia-box-start"]
