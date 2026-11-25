FROM eclipse-temurin:21-jdk-alpine AS build
WORKDIR /workspace
COPY . .
# Issue #307: 외부 저장소의 일시적 네트워크 오류에 대비해 의존성 다운로드 재시도를 늘린다.
# (Gradle 기본값: 3회, 첫 대기 125ms → 5회, 첫 대기 2초부터 지수 증가)
RUN sh ./gradlew --no-daemon --console=plain \
      -Dorg.gradle.internal.repository.max.retries=5 \
      -Dorg.gradle.internal.repository.initial.backoff=2000 \
      bootJar \
    && find build/libs -maxdepth 1 -type f -name '*.jar' ! -name '*-plain.jar' > /tmp/jars \
    && test "$(wc -l < /tmp/jars)" -eq 1 \
    && cp "$(cat /tmp/jars)" /app.jar

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app.jar app.jar
USER app
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
