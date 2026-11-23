package com.peakorder.inventory.service;

import com.peakorder.inventory.dto.HoldRequest;
import com.peakorder.inventory.dto.HoldResponse;
import com.peakorder.inventory.dto.RestoreResponse;
import com.peakorder.inventory.entity.Inventory;
import com.peakorder.inventory.entity.InventoryReservation;
import com.peakorder.inventory.entity.InventoryReservationItem;
import com.peakorder.inventory.exception.BusinessException;
import com.peakorder.inventory.exception.ErrorCode;
import com.peakorder.inventory.repository.InventoryRepository;
import com.peakorder.inventory.repository.InventoryReservationItemRepository;
import com.peakorder.inventory.repository.InventoryReservationRepository;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class InventoryHoldService {

  private final InventoryRepository inventoryRepository;
  private final InventoryReservationRepository reservationRepository;
  private final InventoryReservationItemRepository itemRepository;
  private final Duration holdTtl;

  public InventoryHoldService(
      InventoryRepository inventoryRepository,
      InventoryReservationRepository reservationRepository,
      InventoryReservationItemRepository itemRepository,
      @Value("${inventory.stock-hold-ttl}") Duration holdTtl) {
    this.inventoryRepository = inventoryRepository;
    this.reservationRepository = reservationRepository;
    this.itemRepository = itemRepository;
    this.holdTtl = holdTtl;
  }

  @Transactional
  public HoldResponse hold(HoldRequest request) {
    // 1. 이미 받은 예약이면 그대로 돌려준다 (빠른 응답용. 동시 요청은 4단계에서 다시 확인)
    Optional<InventoryReservation> existing =
        reservationRepository.findByOrderId(request.orderId());
    if (existing.isPresent()) {
      return HoldResponse.from(existing.get());
    }

    // 2. 같은 메뉴는 합치고, 메뉴 번호 순서로 정렬한다
    Map<Long, Integer> quantities = new TreeMap<>();
    for (HoldRequest.Item item : request.items()) {
      quantities.merge(item.menuId(), item.quantity(), Integer::sum);
    }

    // 3. 메뉴별 재고를 모두 잠근다
    List<Inventory> locked = new ArrayList<>();
    for (Long menuId : quantities.keySet()) {
      locked.add(
          inventoryRepository
              .findByMenuIdForUpdate(menuId)
              .orElseThrow(() -> new BusinessException(ErrorCode.STOCK_NOT_LINKED)));
    }

    // 4. 잠근 뒤 기존 확보를 다시 확인한다. 같은 orderId의 동시 요청은 같은 메뉴를 담아 같은 재고 행
    //    잠금에서 줄을 서므로, 먼저 끝난 요청이 커밋한 확보가 여기서 보인다(READ COMMITTED).
    //    다시 확인하지 않으면 order_id UNIQUE 위반으로 500이 된다.
    Optional<InventoryReservation> committed =
        reservationRepository.findByOrderId(request.orderId());
    if (committed.isPresent()) {
      return HoldResponse.from(committed.get());
    }

    // 5. 확보한다
    int index = 0;
    for (Integer quantity : quantities.values()) {
      locked.get(index++).reserve(quantity);
    }

    // 6. 예약 장부와 메뉴별 줄을 저장한다
    InventoryReservation reservation =
        reservationRepository.save(
            new InventoryReservation(request.orderId(), OffsetDateTime.now().plus(holdTtl)));
    for (Map.Entry<Long, Integer> entry : quantities.entrySet()) {
      itemRepository.save(
          new InventoryReservationItem(reservation.getId(), entry.getKey(), entry.getValue()));
    }

    return HoldResponse.from(reservation);
  }

  @Transactional
  public void confirm(Long holdId) {
    // 1. 예약을 잠그고 찾는다. 없으면 404
    InventoryReservation reservation = findHoldForUpdate(holdId);

    // 2. 이미 확정됐으면 아무것도 안 하고 성공
    if ("CONFIRMED".equals(reservation.getStatus())) {
      return;
    }

    // 3. 임시 확보 상태가 아니거나 시간이 지났으면 409
    if (!"RESERVED".equals(reservation.getStatus())
        || reservation.isExpired(OffsetDateTime.now())) {
      throw new BusinessException(ErrorCode.HOLD_NOT_ACTIVE);
    }

    // 4. 메뉴 번호 순서로 재고를 잠그고 실제 차감한다
    for (InventoryReservationItem item : sortedItems(holdId)) {
      lockInventory(item.getMenuId()).confirm(item.getQuantity());
    }

    // 5. 예약 상태를 확정으로 바꾼다
    reservation.confirm();
  }

  @Transactional
  public void release(Long holdId) {
    // 1. 예약을 잠그고 찾는다. 없으면 404
    InventoryReservation reservation = findHoldForUpdate(holdId);

    // 2. 이미 해제됐거나 만료됐으면 아무것도 안 하고 성공
    if ("RELEASED".equals(reservation.getStatus()) || "EXPIRED".equals(reservation.getStatus())) {
      return;
    }

    // 3. 확정·복원된 예약은 해제할 수 없다. 409
    if (!"RESERVED".equals(reservation.getStatus())) {
      throw new BusinessException(ErrorCode.HOLD_NOT_ACTIVE);
    }

    // 4. 메뉴 번호 순서로 재고를 잠그고 찜만 뗀다
    for (InventoryReservationItem item : sortedItems(holdId)) {
      lockInventory(item.getMenuId()).release(item.getQuantity());
    }

    // 5. 예약 상태를 해제로 바꾼다
    reservation.release();
  }

  @Transactional
  public RestoreResponse restore(Long orderId) {
    // 1. 주문 번호로 예약을 잠그고 찾는다. 없으면 복원할 게 없으니 409
    InventoryReservation reservation =
        reservationRepository
            .findByOrderIdForUpdate(orderId)
            .orElseThrow(() -> new BusinessException(ErrorCode.RESTORE_NOT_APPLICABLE));

    // 2. 이미 복원됐으면 아무것도 안 하고 성공
    if ("RESTORED".equals(reservation.getStatus())) {
      return new RestoreResponse(orderId, true);
    }

    // 3. 확정된 예약만 복원할 수 있다. 나머지는 409
    if (!"CONFIRMED".equals(reservation.getStatus())) {
      throw new BusinessException(ErrorCode.RESTORE_NOT_APPLICABLE);
    }

    // 4. 메뉴 번호 순서로 재고를 잠그고 실물을 되돌린다
    for (InventoryReservationItem item : sortedItems(reservation.getId())) {
      lockInventory(item.getMenuId()).restore(item.getQuantity());
    }

    // 5. 예약 상태를 복원으로 바꾼다
    reservation.restore();
    return new RestoreResponse(orderId, true);
  }

  @Transactional
  public void expire(Long holdId) {
    // 1. 예약을 잠그고 찾는다
    InventoryReservation reservation = findHoldForUpdate(holdId);

    // 2. 그 사이 확정·해제됐거나 아직 시간이 안 됐으면 건드리지 않는다
    if (!"RESERVED".equals(reservation.getStatus())
        || !reservation.isExpired(OffsetDateTime.now())) {
      return;
    }

    // 3. 메뉴 번호 순서로 재고를 잠그고 찜만 뗀다
    for (InventoryReservationItem item : sortedItems(holdId)) {
      lockInventory(item.getMenuId()).release(item.getQuantity());
    }

    // 4. 예약 상태를 만료로 바꾼다
    reservation.expire();
  }

  // ===== 반복되는 일을 묶은 도우미 =====

  private InventoryReservation findHoldForUpdate(Long holdId) {
    return reservationRepository
        .findByIdForUpdate(holdId)
        .orElseThrow(() -> new BusinessException(ErrorCode.HOLD_NOT_FOUND));
  }

  private List<InventoryReservationItem> sortedItems(Long holdId) {
    return itemRepository.findByReservationId(holdId).stream()
        .sorted(Comparator.comparing(InventoryReservationItem::getMenuId))
        .toList();
  }

  private Inventory lockInventory(Long menuId) {
    return inventoryRepository
        .findByMenuIdForUpdate(menuId)
        .orElseThrow(() -> new BusinessException(ErrorCode.INVENTORY_NOT_FOUND));
  }
}
