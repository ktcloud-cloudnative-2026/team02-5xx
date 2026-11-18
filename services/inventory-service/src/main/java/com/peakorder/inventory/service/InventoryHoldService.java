package com.peakorder.inventory.service;

import com.peakorder.inventory.dto.HoldRequest;
import com.peakorder.inventory.dto.HoldResponse;
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
    // 1. 이미 받은 예약이면 그대로 돌려준다
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

    // 3. 메뉴별 재고를 잠그고 확보한다
    for (Map.Entry<Long, Integer> entry : quantities.entrySet()) {
      Inventory inventory =
          inventoryRepository
              .findByMenuIdForUpdate(entry.getKey())
              .orElseThrow(() -> new BusinessException(ErrorCode.STOCK_NOT_LINKED));
      inventory.reserve(entry.getValue());
    }

    // 4. 예약 장부와 메뉴별 줄을 저장한다
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
    InventoryReservation reservation =
        reservationRepository
            .findByIdForUpdate(holdId)
            .orElseThrow(() -> new BusinessException(ErrorCode.HOLD_NOT_FOUND));

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
    List<InventoryReservationItem> items =
        itemRepository.findByReservationId(holdId).stream()
            .sorted(Comparator.comparing(InventoryReservationItem::getMenuId))
            .toList();
    for (InventoryReservationItem item : items) {
      Inventory inventory =
          inventoryRepository
              .findByMenuIdForUpdate(item.getMenuId())
              .orElseThrow(() -> new BusinessException(ErrorCode.INVENTORY_NOT_FOUND));
      inventory.confirm(item.getQuantity());
    }

    // 5. 예약 상태를 확정으로 바꾼다
    reservation.confirm();
  }
}
