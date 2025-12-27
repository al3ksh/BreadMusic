FROM eclipse-temurin:17-jre-alpine

WORKDIR /opt/Lavalink

ARG LAVALINK_VERSION=4.0.8
RUN wget -q https://github.com/lavalink-devs/Lavalink/releases/download/${LAVALINK_VERSION}/Lavalink.jar -O Lavalink.jar

COPY application.yml .

RUN mkdir -p plugins
COPY plugins/ ./plugins/

EXPOSE 2333

CMD ["java", "-jar", "Lavalink.jar"]
