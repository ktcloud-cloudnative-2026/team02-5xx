package com.peakorder.menu.repository;

import com.peakorder.menu.entity.Menu;
import com.peakorder.menu.entity.MenuOption;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

/** Read-only administrator queries. No sales-status restriction is applied. */
public interface AdminMenuQueryRepository extends Repository<Menu, Long> {
  @Query("select m from Menu m join fetch m.category")
  List<Menu> findAllWithCategory();

  @Query("select m from Menu m join fetch m.category where m.id = :menuId")
  Optional<Menu> findWithCategoryById(@Param("menuId") Long menuId);

  @Query("select o from MenuOption o where o.menu.id = :menuId order by o.id asc")
  List<MenuOption> findOptionsByMenuId(@Param("menuId") Long menuId);
}
