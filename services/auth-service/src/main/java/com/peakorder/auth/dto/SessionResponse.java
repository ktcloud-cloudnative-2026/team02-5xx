package com.peakorder.auth.dto;

import com.peakorder.auth.entity.User;
import com.peakorder.auth.entity.UserRole;

public record SessionResponse(
    String accessToken, String tokenType, long expiresIn, SessionUser user) {
  public record SessionUser(Long id, String email, UserRole role) {
    public static SessionUser from(User user) {
      return new SessionUser(user.getId(), user.getEmail(), user.getRole());
    }
  }

  @Override
  public String toString() {
    return "SessionResponse[redacted]";
  }
}
