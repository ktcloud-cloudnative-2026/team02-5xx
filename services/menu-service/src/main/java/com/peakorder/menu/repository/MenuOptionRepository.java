package com.peakorder.menu.repository;

import com.peakorder.menu.entity.MenuOption;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MenuOptionRepository extends JpaRepository<MenuOption, Long> {
  List<MenuOption> findByMenuIdOrderByIdAsc(Long menuId);
}
