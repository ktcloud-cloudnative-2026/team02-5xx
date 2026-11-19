package com.peakorder.menu.repository;

import com.peakorder.menu.entity.Menu;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MenuRepository extends JpaRepository<Menu, Long> {
  @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
  @org.springframework.data.jpa.repository.Query("select m from Menu m where m.id = :id")
  java.util.Optional<Menu> findForInformationUpdate(
      @org.springframework.data.repository.query.Param("id") Long id);
}
