# Asterisk 22 (LTS) for the call center: PJSIP over UDP and WebSocket, WebRTC (DTLS-SRTP), ARI.
# Built from the official source tarball; pjproject is the version Asterisk bundles and tests with.
FROM debian:bookworm-slim AS build
ARG ASTERISK_TARBALL=asterisk-22-current.tar.gz
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential ca-certificates wget bzip2 patch pkg-config python3 xmlstarlet \
      libssl-dev libncurses-dev libnewt-dev libxml2-dev libsqlite3-dev uuid-dev \
      libjansson-dev libedit-dev libsrtp2-dev libcurl4-openssl-dev \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /usr/src
RUN wget -q "https://downloads.asterisk.org/pub/telephony/asterisk/${ASTERISK_TARBALL}" \
  && tar xzf "${ASTERISK_TARBALL}" && rm "${ASTERISK_TARBALL}" && mv asterisk-22* asterisk
WORKDIR /usr/src/asterisk
RUN ./configure --with-pjproject-bundled --with-jansson-bundled=no --libdir=/usr/lib >/dev/null \
  && make menuselect.makeopts \
  # Portable binary: the image may run on a different CPU than the one that built it.
  && menuselect/menuselect --disable BUILD_NATIVE menuselect.makeopts \
  && make -j"$(nproc)" >/dev/null \
  && make install DESTDIR=/out >/dev/null
# Debian's /var/run is a symlink to /run; copying a real directory over it fails.
RUN mkdir -p /out/run && cp -a /out/var/run/. /out/run/ && rm -rf /out/var/run

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates libssl3 libncurses6 libnewt0.52 libxml2 libsqlite3-0 libuuid1 \
      libjansson4 libedit2 libsrtp2-1 libcurl4 iproute2 \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --home /var/lib/asterisk asterisk
COPY --from=build /out/ /
COPY config/ /opt/nexo-asterisk/
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
  && mkdir -p /etc/asterisk /var/run/asterisk /var/log/asterisk /var/spool/asterisk \
  && chown -R asterisk:asterisk /etc/asterisk /var/lib/asterisk /var/run/asterisk /var/log/asterisk /var/spool/asterisk
# 5060/udp SIP · 8088/tcp HTTP (ARI + SIP over WebSocket) · 10000-10099/udp RTP
EXPOSE 5060/udp 8088/tcp 10000-10099/udp
ENTRYPOINT ["docker-entrypoint.sh"]
