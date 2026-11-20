package com.peakorder.auth.dto;

import com.peakorder.auth.entity.User;
import com.peakorder.auth.entity.UserRole;

public record CurrentUserResponse(Long id, String email, String nickname, UserRole role) {
  public static CurrentUserResponse from(User user) {
    return new CurrentUserResponse(
        user.getId(), user.getEmail(), user.getNickname(), user.getRole());
  }
}
