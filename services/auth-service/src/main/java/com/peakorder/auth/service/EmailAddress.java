package com.peakorder.auth.service;

import com.peakorder.auth.exception.BusinessException;
import com.peakorder.auth.exception.ErrorCode;
import jakarta.validation.Validator;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.Locale;

final class EmailAddress {
  private EmailAddress() {}

  static String normalize(String value, Validator validator) {
    if (value == null) throw new BusinessException(ErrorCode.INVALID_REQUEST);
    String email = value.strip();
    if (!validator.validate(new Input(email)).isEmpty())
      throw new BusinessException(ErrorCode.INVALID_REQUEST);
    int separator = email.lastIndexOf('@');
    return email.substring(0, separator + 1)
        + email.substring(separator + 1).toLowerCase(Locale.ROOT);
  }

  private record Input(@NotBlank @Email @Size(max = 254) String value) {}
}
