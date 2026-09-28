FROM bluenviron/mediamtx:1.21.1 AS media
FROM python:3.12-slim-bookworm
RUN useradd -u 1000 -m media
COPY --from=media /mediamtx /usr/local/bin/mediamtx
COPY supervise.py /app/supervise.py
USER media
CMD ["python","-u","/app/supervise.py"]
