# FFmpeg for meeting recordings and video lessons (MT-1, EL-3) when the API runs on the host
# (dev on Windows/macOS). The API calls it with FFMPEG_COMMAND="docker exec -i -w /work nexo-ffmpeg ffmpeg".
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /work
CMD ["sleep", "infinity"]
