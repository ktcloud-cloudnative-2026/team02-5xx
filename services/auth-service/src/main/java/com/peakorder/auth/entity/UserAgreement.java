package com.peakorder.auth.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;

@Entity
@Table(
    name = "user_agreements",
    uniqueConstraints =
        @UniqueConstraint(
            name = "uk_user_agreements_user_type_version",
            columnNames = {"user_id", "type", "version"}))
public class UserAgreement {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "user_id", nullable = false)
  private User user;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 20)
  private AgreementType type;

  @Column(nullable = false, length = 64)
  private String version;

  @Column(nullable = false)
  private boolean agreed;

  @Column(name = "agreed_at", nullable = false)
  private Instant agreedAt;

  protected UserAgreement() {}

  public UserAgreement(User user, AgreementType type, String version, Instant agreedAt) {
    this.user = user;
    this.type = type;
    this.version = version;
    this.agreed = true;
    this.agreedAt = agreedAt;
  }
}
