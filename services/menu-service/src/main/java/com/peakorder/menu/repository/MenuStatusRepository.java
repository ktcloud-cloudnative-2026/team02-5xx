package com.peakorder.menu.repository;

import com.peakorder.menu.entity.Menu;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

/** A narrow atomic write; never flush a stale full Menu snapshot to change its status. */
public interface MenuStatusRepository extends Repository<Menu, Long> {
  @Modifying(flushAutomatically = true)
  @Query(
      value =
          "update menus set status = :status, updated_at = greatest(clock_timestamp(), updated_at) where id = :id and status <> :status",
      nativeQuery = true)
  int changeIfDifferent(@Param("id") Long id, @Param("status") String status);
}
