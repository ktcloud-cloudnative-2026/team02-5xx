package com.peakorder.auth.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "refresh_tokens")
public class RefreshToken {
  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "user_id", nullable = false)
  private long userId;

  @Column(name = "session_id", nullable = false)
  private UUID sessionId;

  @Column(name = "token_hash", nullable = false, length = 64)
  private String tokenHash;

  @Column(name = "expires_at", nullable = false)
  private Instant expiresAt;

  @Column(nullable = false)
  private boolean revoked;

  @Column(name = "remember_me", nullable = false)
  private boolean rememberMe;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  protected RefreshToken() {}

  public RefreshToken(
      long userId,
      UUID sessionId,
      String tokenHash,
      Instant expiresAt,
      boolean rememberMe,
      Instant createdAt) {
    this.userId = userId;
    this.sessionId = sessionId;
    this.tokenHash = tokenHash;
    this.expiresAt = expiresAt;
    this.rememberMe = rememberMe;
    this.createdAt = createdAt;
  }

  public UUID getSessionId() {
    return sessionId;
  }

  public Instant getExpiresAt() {
    return expiresAt;
  }

  public boolean isRevoked() {
    return revoked;
  }

  public boolean isRememberMe() {
    return rememberMe;
  }
}
