package com.peakorder.auth;

import static com.peakorder.auth.AuthSessionTestSupport.*;
import static org.assertj.core.api.Assertions.*;

import com.peakorder.auth.config.SessionConfiguration;
import com.peakorder.auth.service.AccessTokenService;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

class SessionConfigurationTests {
  private final ApplicationContextRunner runner =
      new ApplicationContextRunner().withUserConfiguration(SessionConfiguration.class);

  @Test
  void disabledFeatureNeedsNoKeysAndDoesNotGenerateDevelopmentKeys() {
    runner.run(context -> assertThat(context).doesNotHaveBean(AccessTokenService.class));
  }

  @Test
  void explicitEnableWithoutRequiredConfigurationFailsClosed() {
    runner
        .withPropertyValues("auth.session.enabled=true")
        .run(context -> assertThat(context).hasFailed());
  }

  @Test
  void validExplicitKeysAndOriginEnableTheFeature(@TempDir Path directory) throws Exception {
    writeKeys(directory);
    configured(directory)
        .run(
            context -> {
              assertThat(context).hasNotFailed().hasSingleBean(AccessTokenService.class);
              var tokens = context.getBean(AccessTokenService.class);
              assertThat(tokens.verify(tokens.issue(user()))).isEqualTo(42);
            });
  }

  @Test
  void emptyOriginListFailsStartupEvenWhenKeysAreValid(@TempDir Path directory) throws Exception {
    writeKeys(directory);
    configured(directory)
        .withPropertyValues("auth.session.allowed-origins=")
        .run(context -> assertThat(context).hasFailed());
  }

  private ApplicationContextRunner configured(Path directory) {
    return runner.withPropertyValues(
        "auth.session.enabled=true",
        "auth.session.issuer=" + properties().issuer(),
        "auth.session.audience=" + properties().audience(),
        "auth.session.key-id=" + properties().keyId(),
        "auth.session.private-key-file=" + directory.resolve("private.pem"),
        "auth.session.public-key-file=" + directory.resolve("public.pem"),
        "auth.session.allowed-origins=" + ORIGIN);
  }
}
