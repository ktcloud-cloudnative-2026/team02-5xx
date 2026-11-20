package com.peakorder.auth.repository;

import com.peakorder.auth.entity.RefreshToken;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface RefreshTokenRepository extends JpaRepository<RefreshToken, Long> {
  @Query("select t.userId from RefreshToken t where t.tokenHash = :hash")
  Optional<Long> findOwner(@Param("hash") String hash);

  Optional<RefreshToken> findByTokenHash(String tokenHash);

  @Modifying(flushAutomatically = true)
  @Query(
      "update RefreshToken t set t.revoked = true where t.userId = :userId and t.sessionId = :sessionId and t.revoked = false")
  int revokeSession(@Param("userId") long userId, @Param("sessionId") UUID sessionId);
}
