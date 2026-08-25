FROM eclipse-temurin:25-jre

WORKDIR /opt/Lavalink

RUN apt-get update \
	&& apt-get install -y --no-install-recommends wget ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

ARG LAVALINK_VERSION=4.2.2
ARG LAVASRC_VERSION=4.8.3
RUN wget -q https://github.com/lavalink-devs/Lavalink/releases/download/${LAVALINK_VERSION}/Lavalink.jar -O Lavalink.jar \
	&& mkdir -p plugins \
	&& wget -q https://github.com/topi314/LavaSrc/releases/download/${LAVASRC_VERSION}/lavasrc-plugin-${LAVASRC_VERSION}.jar -O plugins/lavasrc-plugin-${LAVASRC_VERSION}.jar

COPY application.example.yml application.yml

EXPOSE 2333

CMD ["java", "-jar", "Lavalink.jar"]
