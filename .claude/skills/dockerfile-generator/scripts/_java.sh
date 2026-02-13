#!/usr/bin/env bash
# Java Dockerfile generation -- sourced by generate.sh
# Produces Maven/Gradle build with Eclipse Temurin JRE runtime
set -Eeuo pipefail
shopt -s inherit_errexit
IFS=$'\n\t'

# --- [CONSTANTS] --------------------------------------------------------------

declare -Ar _JAVA_JAR_PATHS=(
    [maven]="target/app.jar"
    [gradle]="build/libs/app.jar"
)
declare -Ar _JAVA_BUILDER_DISPATCH=(
    [maven]=_java_builder_maven
    [gradle]=_java_builder_gradle
)

# --- [FUNCTIONS] --------------------------------------------------------------

_java_builder_maven() {
    cat <<'EOF'
COPY --link mvnw pom.xml ./
COPY --link .mvn .mvn
RUN --mount=type=cache,target=/root/.m2 ./mvnw dependency:go-offline
COPY --link src ./src
RUN --mount=type=cache,target=/root/.m2 ./mvnw clean package -DskipTests && mv target/*.jar target/app.jar
EOF
}
_java_builder_gradle() {
    cat <<'EOF'
COPY --link gradlew ./
COPY --link gradle gradle
COPY --link build.gradle settings.gradle ./
RUN --mount=type=cache,target=/root/.gradle ./gradlew dependencies --no-daemon
COPY --link src ./src
RUN --mount=type=cache,target=/root/.gradle ./gradlew build -x test --no-daemon && mv build/libs/*.jar build/libs/app.jar
EOF
}

# --- [EXPORT] -----------------------------------------------------------------

_java_dockerfile() {
    local -r ver="$1" port="$2" tool="${3:-maven}"
    local -r builder="${_JAVA_BUILDER_DISPATCH[${tool}]:-_java_builder_maven}"
    local -r jar_path="${_JAVA_JAR_PATHS[${tool}]:-build/libs/app.jar}"
    cat <<EOF
# syntax=docker/dockerfile:1
ARG JAVA_VERSION=${ver}
ARG GIT_SHA="unknown"
ARG BUILD_DATE="unknown"
FROM eclipse-temurin:\${JAVA_VERSION}-jdk-alpine AS builder
WORKDIR /app
EOF
    "${builder}"
    cat <<EOF
FROM eclipse-temurin:\${JAVA_VERSION}-jre-alpine AS runtime
ARG GIT_SHA
ARG BUILD_DATE
LABEL org.opencontainers.image.revision="\${GIT_SHA}" \\
      org.opencontainers.image.created="\${BUILD_DATE}"
RUN <<SHELL
addgroup -g 1001 -S appgroup
adduser -S appuser -u 1001 -G appgroup
SHELL
WORKDIR /app
COPY --link --from=builder --chown=appuser:appgroup --chmod=555 /app/${jar_path} ./app.jar
USER appuser
EXPOSE ${port}
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --start-interval=5s --retries=3 \\
    CMD ["wget", "--spider", "-q", "http://localhost:${port}/actuator/health"]
ENTRYPOINT ["java", "-jar", "app.jar"]
EOF
}
