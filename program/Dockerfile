FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core && rm -rf /var/lib/apt/lists/* && useradd -u 1000 -m program
WORKDIR /app
COPY program.py ./
USER program
CMD ["python","-u","program.py"]
