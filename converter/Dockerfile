# RMC2 document converter: DOCX -> PDF with the official LibreOffice build, as a Vercel container.
# Same LibreOffice version as the PC (26.8.1); proven in the phase 1 proof (11/11 page counts).
FROM node:22-bookworm-slim

ARG LO_VERSION=26.8.1
ARG LO_SHA256=30903df3b9f61360d9660cd707de48cd2831469114492a5008ed58a0ac77d044

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl fontconfig \
      libcairo2 libcups2 libdbus-1-3 libnss3 libxinerama1 libxrandr2 libxslt1.1 libsm6 libice6 libx11-xcb1 libgl1 \
      libglib2.0-0 libxext6 libxrender1 libxtst6 libfreetype6 libfontconfig1 \
      fonts-crosextra-caladea fonts-crosextra-carlito fonts-liberation2 fonts-dejavu-core \
 && curl -fsSL -o /tmp/lo.tar.gz "https://download.documentfoundation.org/libreoffice/stable/${LO_VERSION}/deb/x86_64/LibreOffice_${LO_VERSION}_Linux_x86-64_deb.tar.gz" \
 && echo "${LO_SHA256}  /tmp/lo.tar.gz" | sha256sum -c - \
 && mkdir /tmp/lo && tar -xzf /tmp/lo.tar.gz -C /tmp/lo --strip-components=1 \
 && cd /tmp/lo/DEBS && dpkg -i *.deb \
 && ln -sf /opt/libreoffice26.8/program/soffice /usr/local/bin/soffice \
 && cd / && rm -rf /tmp/lo /tmp/lo.tar.gz /var/lib/apt/lists/* \
 && fc-cache -f \
 && soffice --version

ENV HOME=/tmp NODE_ENV=production
WORKDIR /app
COPY server.mjs ./
CMD ["node", "server.mjs"]
