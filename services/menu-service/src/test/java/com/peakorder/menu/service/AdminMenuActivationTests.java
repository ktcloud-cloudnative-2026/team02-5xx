package com.peakorder.menu.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.core.env.SystemEnvironmentPropertySource;

class AdminMenuActivationTests {
  private final ApplicationContextRunner runner =
      new ApplicationContextRunner().withUserConfiguration(AdminMenuActivation.class);

  private ApplicationContextRunner environment(String value) {
    return runner.withInitializer(
        context ->
            context
                .getEnvironment()
                .getPropertySources()
                .addFirst(
                    new SystemEnvironmentPropertySource(
                        "menu-test-env", Map.of("MENU_ADMIN_ENABLED", value))));
  }

  @Test
  void unsetDefaultsOff() {
    runner.run(
        context -> {
          assertThat(context).hasNotFailed();
          assertThat(context.getBean(AdminMenuActivation.class).isEnabled()).isFalse();
        });
  }

  @Test
  void explicitFalseStaysOff() {
    environment("false")
        .run(
            context -> {
              assertThat(context).hasNotFailed();
              assertThat(context.getBean(AdminMenuActivation.class).isEnabled()).isFalse();
            });
  }

  @Test
  void explicitTrueEnablesOnlyTheDeploymentGate() {
    environment("true")
        .run(
            context -> {
              assertThat(context).hasNotFailed();
              assertThat(context.getBean(AdminMenuActivation.class).isEnabled()).isTrue();
            });
  }

  @ParameterizedTest
  @ValueSource(strings = {"", "not-a-boolean"})
  void invalidConfigurationCannotStartAnEnabledApplication(String value) {
    environment(value).run(context -> assertThat(context).hasFailed());
  }
}
