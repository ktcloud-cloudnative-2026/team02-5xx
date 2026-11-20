package com.peakorder.inventory.repository;

import com.peakorder.inventory.entity.InventoryReservationItem;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface InventoryReservationItemRepository
    extends JpaRepository<InventoryReservationItem, Long> {

  List<InventoryReservationItem> findByReservationId(Long reservationId);

  // RESERVED는 확정·해제될 수 있고, CONFIRMED는 주문 취소 시 II-04가 메뉴 번호로 재고를 찾아 복원한다.
  // 둘 중 하나라도 있으면 그 메뉴의 재고 연결을 바꾸면 안 된다.
  @Query(
      "select case when count(i) > 0 then true else false end"
          + " from InventoryReservationItem i, InventoryReservation r"
          + " where i.reservationId = r.id and i.menuId = :menuId"
          + " and r.status in ('RESERVED', 'CONFIRMED')")
  boolean existsHoldOrConfirmedForMenu(Long menuId);
}
