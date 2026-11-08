FROM debian:bookworm-slim
# tcpdump/tshark/iproute2: voice-quality runs (run-sipp.mjs --pcap/--netem) capture RTP and shape the caller's link.
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends sip-tester tcpdump tshark iproute2 \
  && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["sipp"]
