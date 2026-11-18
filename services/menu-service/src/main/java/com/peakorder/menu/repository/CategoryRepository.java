package com.peakorder.menu.repository;

import com.peakorder.menu.entity.Category;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CategoryRepository extends JpaRepository<Category, Long> {
  List<Category> findAllByOrderBySortOrderAscIdAsc();
}
