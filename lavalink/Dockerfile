FROM eclipse-temurin:25-jre

WORKDIR /opt/Lavalink

RUN apt-get update \
	&& apt-get install -y --no-install-recommends wget ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

ARG LAVALINK_VERSION=4.2.2
RUN wget -q https://github.com/lavalink-devs/Lavalink/releases/download/${LAVALINK_VERSION}/Lavalink.jar -O Lavalink.jar

COPY application.example.yml application.yml

RUN mkdir -p plugins
COPY plugins/ ./plugins/

EXPOSE 2333

CMD ["java", "-jar", "Lavalink.jar"]
