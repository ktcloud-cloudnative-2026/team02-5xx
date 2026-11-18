package com.peakorder.menu.repository;

import com.peakorder.menu.entity.Menu;
import com.peakorder.menu.entity.MenuStatus;
import java.util.List;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MenuRepository extends JpaRepository<Menu, Long> {
  @EntityGraph(attributePaths = "category")
  List<Menu> findAllByStatusNot(MenuStatus status);
}
